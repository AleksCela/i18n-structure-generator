// syncOperations.js
import fs from 'fs/promises';
import path from 'path';
// Import specific functions needed from utils
import { createEmptyStructure, syncStructure, setValueAtPath } from './utils.js';
// Import removal function (no longer needed for AST, but keep structure if other logic used it)
// Removed: import { removeEntryFromI18nConfig } from './astUpdater.js';
// Import BOTH translator functions
import { translateJsonFileContent, translateStructureInBatches } from './translator.js';

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
 * - Translates whole new files using `translateJsonFileContent` if enabled.
 * - Deletes extra files. (Config update removed)
 * - Syncs structure of existing files using `syncStructure`.
 * - Translates *only the newly added parts* within existing files using `translateStructureInBatches` if enabled.
 *
 * @param {string} baseDir - Absolute path to base translation dir.
 * @param {string} sourceLang - Source language code.
 * @param {string[]} targetLangs - Array of target language codes.
 * @param {boolean} enableTranslation - Should we attempt translation?
 * @param {boolean} attemptAutoUpdate - *This parameter is no longer used but kept for signature consistency if needed elsewhere, ideally remove.*
 * @param {string | null} absoluteConfigFile - *This parameter is no longer used.*
 * @param {string | null} configDir - *This parameter is no longer used.*
 */
export async function runSync(baseDir, sourceLang, targetLangs, enableTranslation, attemptAutoUpdate, absoluteConfigFile, configDir) {
    // Note: attemptAutoUpdate, absoluteConfigFile, configDir are no longer used in this function's logic
    const mode = enableTranslation ? 'Translation & Sync' : 'Sync';
    console.log(`\n🔄 Starting Structure ${mode}...`);
    const sourceDir = path.join(baseDir, sourceLang);
    let totalChangesCount = 0; // Count significant operations

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

            // --- 1. Add missing files (Translate WHOLE file if enabled) ---
            for (const filename of filesToAdd) {
                const sourceFilePath = path.join(sourceDir, filename);
                const targetFilePath = path.join(targetDir, filename);
                const action = enableTranslation ? 'Adding & Translating file (whole JSON):' : 'Adding file:';
                console.log(`  ➕ ${action} ${targetLang}/${filename}`);
                try {
                    // Read source, parse JSON
                    const sourceContent = await fs.readFile(sourceFilePath, 'utf-8');
                    const sourceJson = JSON.parse(sourceContent); // Assume source is valid JSON

                    // Determine target content: translate or create empty
                    let targetJson;
                    if (enableTranslation) {
                        // Use whole file translator function
                        targetJson = await translateJsonFileContent(sourceJson, sourceLang, targetLang);
                    } else {
                        targetJson = createEmptyStructure(sourceJson);
                    }

                    // Write the result to the target file
                    await fs.writeFile(targetFilePath, JSON.stringify(targetJson, null, 2), 'utf-8');
                    langChangesCount++;
                    // No AST update logic here anymore

                } catch (error) {
                    // Log specific error for this file, but continue with others
                    console.error(`    ❌ Error adding file ${filename} for ${targetLang}: ${error.message}`);
                }
            } // End filesToAdd loop

            // --- 2. Delete extra files ---
            for (const filename of filesToDelete) {
                const targetFilePath = path.join(targetDir, filename);
                console.log(`  ➖ Deleting file: ${targetLang}/${filename}`);
                try {
                    // Delete the JSON file
                    await fs.unlink(targetFilePath);
                    langChangesCount++;
                    // *** No call to removeEntryFromI18nConfig needed ***
                } catch (error) {
                    // Log error related to file deletion
                    console.error(`    ❌ Error deleting file ${filename} for ${targetLang}: ${error.message}`);
                }
            } // End filesToDelete loop

            // --- 3. Sync structure of existing files AND translate added parts ---
            for (const filename of filesToSync) {
                const sourceFilePath = path.join(sourceDir, filename);
                const targetFilePath = path.join(targetDir, filename);
                let writeNeeded = false; // Flag to track if file needs saving
                let structureChanged = false; // Flag specific to structural sync result
                let translationApplied = false; // Flag if translations were injected

                try {
                    // Read both source and target files
                    const sourceContent = await fs.readFile(sourceFilePath, 'utf-8');
                    const targetContent = await fs.readFile(targetFilePath, 'utf-8');
                    // Parse source JSON
                    const sourceJson = JSON.parse(sourceContent);
                    // Parse target JSON (handle potential errors)
                    let originalTargetJson;
                    try {
                        originalTargetJson = JSON.parse(targetContent);
                    } catch (parseError) {
                        // If target is invalid, overwrite it with translated (if enabled) or empty structure
                        console.warn(`    ⚠️ Invalid JSON in target file ${targetFilePath}. Overwriting with ${enableTranslation ? 'translated' : 'empty'} source structure. Error: ${parseError.message}`);
                        const replacementJson = enableTranslation
                            ? await translateJsonFileContent(sourceJson, sourceLang, targetLang) // Translate whole file on error
                            : createEmptyStructure(sourceJson);
                        await fs.writeFile(targetFilePath, JSON.stringify(replacementJson, null, 2), 'utf-8');
                        langChangesCount++;
                        continue; // Move to the next file in filesToSync
                    }

                    // Perform recursive structure-only synchronization
                    // It collects info about added nodes into addedNodesCollector
                    const addedNodesCollector = [];
                    const syncResult = syncStructure(
                        sourceJson,
                        originalTargetJson,
                        'root', // Root path for reporting additions
                        addedNodesCollector // Pass array to collect additions
                    );

                    let finalTargetJson = syncResult.updatedNode; // Start with the structurally synced node
                    structureChanged = syncResult.changesMade; // Store if structure was altered

                    // If structural changes occurred AND translation is enabled AND nodes were added
                    if (structureChanged && enableTranslation && addedNodesCollector.length > 0) {
                        console.log(`    ⚙️ Translating ${addedNodesCollector.length} added structure(s)/key(s) for ${targetLang}/${filename}...`);
                        writeNeeded = true; // We will modify the JSON content

                        // Translate each added source structure fragment individually using batching
                        for (const addedInfo of addedNodesCollector) {
                            try {
                                // Translate the sourceValue fragment using the batching translator
                                const translatedValueFragment = await translateStructureInBatches(
                                    addedInfo.sourceValue, // The original value from source
                                    sourceLang,
                                    targetLang
                                );
                                // Inject the translated fragment back into the correct path
                                // This modifies finalTargetJson directly
                                setValueAtPath(finalTargetJson, addedInfo.path, translatedValueFragment);
                                translationApplied = true; // Mark that translation happened
                                // Optional debug log:
                                // console.log(`      ✅ Injected translation at: ${addedInfo.path}`);
                            } catch (translateError) {
                                console.error(`    ❌ Error translating added fragment at path ${addedInfo.path}: ${translateError.message}`);
                                // Keep the empty structure that syncStructure inserted as fallback
                            }
                        } // End loop through addedNodesCollector
                        if (translationApplied) {
                            console.log(`    ✅ Finished translating added part(s) for ${targetLang}/${filename}.`);
                        }
                    }

                    // Determine if writing is needed (structure changed OR translation was applied)
                    writeNeeded = structureChanged; // Write if structure changed (translation implies structure change)

                    if (writeNeeded) {
                        // Refined logging
                        if (translationApplied) {
                            console.log(`    ✏️ Applying structural changes AND injected translations to ${targetLang}/${filename}.`);
                        } else if (structureChanged) {
                            // Log if only structure changed (keys added/removed)
                            console.log(`    ✏️ Applying structural key additions/deletions to ${targetLang}/${filename}.`);
                        }
                        // Write the final JSON back to the target file
                        await fs.writeFile(targetFilePath, JSON.stringify(finalTargetJson, null, 2), 'utf-8');
                        langChangesCount++; // Count sync+translate or just sync as one operation for summary
                    } else {
                        // Log only if no changes were made at all
                        console.log(`    ✨ No structural changes or translations needed for ${targetLang}/${filename}.`);
                    }

                } catch (error) {
                    // Catch errors during read/parse/sync/write for this specific file
                    console.error(`    ❌ Error syncing file ${filename} for ${targetLang}: ${error.message}`);
                }
            } // End loop filesToSync

            // Log summary for the current language
            if (langChangesCount > 0) {
                console.log(`  Finished syncing ${targetLang}. Operations performed: ${langChangesCount}`);
                totalChangesCount += langChangesCount; // Add to overall count
            } else {
                console.log(`  Finished syncing ${targetLang}. No operations were needed.`);
            }

        } catch (error) {
            // Catch errors from compareDirectories or other setup steps for this language
            console.error(`❌ Failed to sync language ${targetLang}: ${error.message}`);
            // Continue to the next language if possible
        }
    } // End loop targetLangs

    // Final summary log for the entire sync operation
    if (totalChangesCount > 0) {
        console.log(`\n✅ Synchronization complete. Approximately ${totalChangesCount} operations performed across target languages.`);
    } else {
        console.log(`\n✅ Synchronization complete. No structural operations were needed.`);
    }
}