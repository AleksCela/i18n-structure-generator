// syncOperations.js
import fs from 'fs/promises';
import path from 'path';
import { createEmptyStructure, syncStructure } from './utils.js';
import { removeEntryFromI18nConfig } from './astUpdater.js'; // Import the remove function

/**
 * Compares source and target directories to determine file differences.
 * Handles cases where source or target directories might not exist.
 *
 * @param {string} sourceDir - Absolute path to the source language directory.
 * @param {string} targetDir - Absolute path to the target language directory.
 * @param {string} targetLang - The target language code (for logging).
 * @returns {Promise<{ filesToAdd: string[], filesToDelete: string[], filesToSync: string[] }>}
 * @throws {Error} If the source directory is inaccessible (excluding ENOENT which is handled).
 */
async function compareDirectories(sourceDir, targetDir, targetLang) {
    let sourceFiles = new Set();
    let targetFiles = new Set();

    // Read source directory
    try {
        const sourceEntries = await fs.readdir(sourceDir, { withFileTypes: true });
        sourceFiles = new Set(
            sourceEntries
                .filter(dirent => dirent.isFile() && dirent.name.endsWith('.json'))
                .map(dirent => dirent.name)
        );
    } catch (error) {
        if (error.code === 'ENOENT') {
            // If source doesn't exist, we cannot sync
            throw new Error(`Sync failed: Source directory not found: ${sourceDir}`);
        }
        // Rethrow other read errors (permissions etc.)
        console.error(`Critical error reading source directory ${sourceDir}:`, error);
        throw error;
    }

    // Read target directory
    try {
        const targetEntries = await fs.readdir(targetDir, { withFileTypes: true });
        targetFiles = new Set(
            targetEntries
                .filter(dirent => dirent.isFile() && dirent.name.endsWith('.json'))
                .map(dirent => dirent.name)
        );
    } catch (error) {
        if (error.code === 'ENOENT') {
            // Target directory doesn't exist, implies all source files need to be added
            console.log(`  Target directory ${targetDir} not found. Will create it and add all source files.`);
            // Ensure the directory exists for subsequent 'add' operations
            try {
                await fs.mkdir(targetDir, { recursive: true });
            } catch (mkdirError) {
                console.error(`   ❌ Failed to create target directory ${targetDir}: ${mkdirError.message}`);
                // If we can't create the dir, we likely can't proceed with this language.
                // Rethrow or handle appropriately depending on desired behavior. Let's rethrow for now.
                throw new Error(`Failed to create target directory ${targetDir}: ${mkdirError.message}`);
            }

        } else {
            // Log other read errors but allow proceeding, sync/delete might still work partially
            console.warn(`  Warning: Could not read target directory ${targetDir}: ${error.message}`);
        }
        // If dir didn't exist or wasn't readable, targetFiles remains an empty Set
    }

    // Determine differences
    const filesToAdd = [...sourceFiles].filter(f => !targetFiles.has(f));
    const filesToDelete = [...targetFiles].filter(f => !sourceFiles.has(f));
    const filesToSync = [...sourceFiles].filter(f => targetFiles.has(f));

    return { filesToAdd, filesToDelete, filesToSync };
}

/**
 * Runs the synchronization process for all target languages.
 * Compares files, adds/deletes/synchronizes structures, and optionally updates config file.
 *
 * @param {string} baseDir - Absolute path to base translation dir.
 * @param {string} sourceLang - Source language code.
 * @param {string[]} targetLangs - Array of target language codes.
 * @param {boolean} attemptAutoUpdate - Should we attempt config updates?
 * @param {string | null} absoluteConfigFile - Absolute path to config file, or null.
 * @param {string | null} configDir - Absolute path to config file's directory, or null.
 */
export async function runSync(baseDir, sourceLang, targetLangs, attemptAutoUpdate, absoluteConfigFile, configDir) {
    console.log("\n🔄 Starting Structure Synchronization...");
    const sourceDir = path.join(baseDir, sourceLang);
    let totalChangesCount = 0; // Count significant operations (add/delete file, apply structure change)

    for (const targetLang of targetLangs) {
        // Don't sync source language with itself
        if (targetLang === sourceLang) {
            console.log(`\nSkipping sync for source language: ${targetLang}`);
            continue;
        }

        console.log(`\nSyncing language: ${targetLang}`);
        const targetDir = path.join(baseDir, targetLang);
        let langChangesCount = 0; // Track changes for this specific language

        try {
            // Compare directories to find differences
            const { filesToAdd, filesToDelete, filesToSync } = await compareDirectories(sourceDir, targetDir, targetLang);

            // --- 1. Add missing files ---
            for (const filename of filesToAdd) {
                const sourceFilePath = path.join(sourceDir, filename);
                const targetFilePath = path.join(targetDir, filename);
                console.log(`  ➕ Adding file: ${targetLang}/${filename}`);
                try {
                    // Read source, create empty structure, write to target
                    const sourceContent = await fs.readFile(sourceFilePath, 'utf-8');
                    const sourceJson = JSON.parse(sourceContent); // Assume source is valid JSON
                    const targetJson = createEmptyStructure(sourceJson);
                    await fs.writeFile(targetFilePath, JSON.stringify(targetJson, null, 2), 'utf-8');
                    langChangesCount++;

                    // TODO (Future AI): Hook translation call here for the new file `targetFilePath`
                    // Example: await translateFile(targetFilePath, sourceLang, targetLang);

                    // TODO: Add logic to call updateI18nConfigFile (add entry) if attemptAutoUpdate is true
                    // This needs careful implementation to pass the right parameters
                    // if (attemptAutoUpdate && absoluteConfigFile) {
                    //      console.log(`    🔧 Attempting to add entry for ${targetLang}/${filename} to config...`);
                    //      try {
                    //          // Note: updateI18nConfigFile expects array of languages and files
                    //          await updateI18nConfigFile(absoluteConfigFile, baseDir, [targetLang], [filename]);
                    //      } catch (configUpdateError) {
                    //          console.error(`    ❌ Error adding entry for ${filename} to config: ${configUpdateError.message}`);
                    //      }
                    // }

                } catch (error) {
                    // Log specific error for this file, but continue with others
                    console.error(`    ❌ Error adding file ${filename} for ${targetLang}: ${error.message}`);
                }
            }

            // --- 2. Delete extra files ---
            for (const filename of filesToDelete) {
                const targetFilePath = path.join(targetDir, filename);
                console.log(`  ➖ Deleting file: ${targetLang}/${filename}`);
                try {
                    // Delete the JSON file
                    await fs.unlink(targetFilePath);
                    langChangesCount++;

                    // Attempt to remove from config ONLY if user opted-in and config path is valid
                    if (attemptAutoUpdate && absoluteConfigFile && configDir) {
                        // Call the function to remove the entry from the AST
                        await removeEntryFromI18nConfig(absoluteConfigFile, targetLang, filename, configDir, baseDir);
                        // Note: We don't count config removal as a separate change for the summary log.
                        // removeEntryFromI18nConfig logs its own success/failure.
                    }
                } catch (error) {
                    // Log error related to file deletion or config update for this file
                    console.error(`    ❌ Error deleting file ${filename} for ${targetLang} or updating config: ${error.message}`);
                }
            }

            // --- 3. Sync structure of existing files ---
            for (const filename of filesToSync) {
                const sourceFilePath = path.join(sourceDir, filename);
                const targetFilePath = path.join(targetDir, filename);
                // Use less verbose logging for the start of sync check
                // console.log(`   syncing file: ${targetLang}/${filename}`);
                try {
                    // Read both source and target files
                    const sourceContent = await fs.readFile(sourceFilePath, 'utf-8');
                    const targetContent = await fs.readFile(targetFilePath, 'utf-8');

                    // Parse source JSON (assume valid)
                    const sourceJson = JSON.parse(sourceContent);

                    // Parse target JSON (handle potential errors)
                    let originalTargetJson;
                    try {
                        originalTargetJson = JSON.parse(targetContent);
                    } catch (parseError) {
                        // If target is invalid, overwrite it with a fresh empty structure
                        console.warn(`    ⚠️ Invalid JSON in target file ${targetFilePath}. Overwriting with empty source structure. Error: ${parseError.message}`);
                        const emptyStructure = createEmptyStructure(sourceJson);
                        await fs.writeFile(targetFilePath, JSON.stringify(emptyStructure, null, 2), 'utf-8');
                        langChangesCount++;
                        // TODO (Future AI): Hook translation call here after resetting structure
                        // Example: await translateFile(targetFilePath, sourceLang, targetLang);
                        continue; // Move to the next file
                    }

                    // Perform the recursive structure synchronization
                    // syncStructure logs detailed add/remove key actions itself
                    const syncResult = syncStructure(sourceJson, originalTargetJson);

                    // Write changes back ONLY if the structure was modified
                    if (syncResult.changesMade) {
                        console.log(`    ✏️ Applying structural changes to ${targetLang}/${filename}`);
                        await fs.writeFile(targetFilePath, JSON.stringify(syncResult.updatedNode, null, 2), 'utf-8');
                        langChangesCount++;
                        // TODO (Future AI): If keys were ADDED here (detected within syncResult?),
                        // trigger translation only for the newly added keys/paths.
                        // Example: await translateNewKeys(targetFilePath, syncResult.addedPaths, sourceLang, targetLang);
                    } else {
                        // Optional: More verbose logging for no changes needed
                        // console.log(`    ✨ No structural changes needed for ${targetLang}/${filename}.`);
                    }

                } catch (error) {
                    // Log errors during read/parse/sync/write for this specific file
                    console.error(`    ❌ Error syncing file ${filename} for ${targetLang}: ${error.message}`);
                }
            } // End loop for filesToSync

            // Log summary for the current language
            if (langChangesCount > 0) {
                console.log(`  Finished syncing ${targetLang}. Operations performed: ${langChangesCount}`);
                totalChangesCount += langChangesCount; // Add to overall count
            } else {
                console.log(`  Finished syncing ${targetLang}. No structural operations were needed.`);
            }

        } catch (error) {
            // Catch errors from compareDirectories or other setup steps for this language
            console.error(`❌ Failed to sync language ${targetLang}: ${error.message}`);
            // Continue to the next language
        }
    } // End loop for targetLangs

    // Final summary log
    if (totalChangesCount > 0) {
        console.log(`\n✅ Synchronization complete. Approximately ${totalChangesCount} operations performed across target languages.`);
    } else {
        console.log(`\n✅ Synchronization complete. No structural operations were needed.`);
    }
}