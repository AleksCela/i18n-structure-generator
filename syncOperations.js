// syncOperations.js
import fs from 'fs/promises';
import path from 'path';
// Import specific functions needed
import { createEmptyStructure, syncStructure, setValueAtPath } from './utils.js'; // Added setValueAtPath
import { removeEntryFromI18nConfig } from './astUpdater.js';
// Import BOTH translator functions now
import { translateJsonFileContent, translateStructureInBatches } from './translator.js';

/**
 * Compares source and target directories to determine file differences.
 * @param {string} sourceDir
 * @param {string} targetDir
 * @param {string} targetLang
 * @returns {Promise<{ filesToAdd: string[], filesToDelete: string[], filesToSync: string[] }>}
 */
async function compareDirectories(sourceDir, targetDir, targetLang) {
    // ... (Implementation from previous full code step - unchanged) ...
    let sourceFiles = new Set();
    let targetFiles = new Set();

    try {
        const sourceEntries = await fs.readdir(sourceDir, { withFileTypes: true });
        sourceFiles = new Set(
            sourceEntries
                .filter(dirent => dirent.isFile() && dirent.name.endsWith('.json'))
                .map(dirent => dirent.name)
        );
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Sync failed: Source directory not found: ${sourceDir}`);
        }
        console.error(`Critical error reading source directory ${sourceDir}:`, error);
        throw error;
    }

    try {
        const targetEntries = await fs.readdir(targetDir, { withFileTypes: true });
        targetFiles = new Set(
            targetEntries
                .filter(dirent => dirent.isFile() && dirent.name.endsWith('.json'))
                .map(dirent => dirent.name)
        );
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`  Target directory ${targetDir} not found. Will create it and add all source files.`);
            try {
                await fs.mkdir(targetDir, { recursive: true });
            } catch (mkdirError) {
                console.error(`   ❌ Failed to create target directory ${targetDir}: ${mkdirError.message}`);
                throw new Error(`Failed to create target directory ${targetDir}: ${mkdirError.message}`);
            }
        } else {
            console.warn(`  Warning: Could not read target directory ${targetDir}: ${error.message}`);
        }
    }

    const filesToAdd = [...sourceFiles].filter(f => !targetFiles.has(f));
    const filesToDelete = [...targetFiles].filter(f => !sourceFiles.has(f));
    const filesToSync = [...sourceFiles].filter(f => targetFiles.has(f));

    return { filesToAdd, filesToDelete, filesToSync };
}


/**
 * Runs the synchronization process for all target languages.
 * - Translates whole new files using `translateJsonFileContent` if enabled.
 * - Deletes extra files and attempts config update if enabled.
 * - Syncs structure of existing files using `syncStructure`.
 * - Translates *only the newly added parts* within existing files using `translateStructureInBatches` if enabled.
 *
 * @param {string} baseDir - Absolute path to base translation dir.
 * @param {string} sourceLang - Source language code.
 * @param {string[]} targetLangs - Array of target language codes.
 * @param {boolean} enableTranslation - Should we attempt translation?
 * @param {boolean} attemptAutoUpdate - Should we attempt config updates?
 * @param {string | null} absoluteConfigFile - Absolute path to config file, or null.
 * @param {string | null} configDir - Absolute path to config file's directory, or null.
 */
export async function runSync(baseDir, sourceLang, targetLangs, enableTranslation, attemptAutoUpdate, absoluteConfigFile, configDir) {
    const mode = enableTranslation ? 'Translation & Sync' : 'Sync';
    console.log(`\n🔄 Starting Structure ${mode}...`);
    const sourceDir = path.join(baseDir, sourceLang);
    let totalChangesCount = 0;

    for (const targetLang of targetLangs) {
        if (targetLang === sourceLang) continue;

        console.log(`\nSyncing language: ${targetLang}`);
        const targetDir = path.join(baseDir, targetLang);
        let langChangesCount = 0;

        try {
            const { filesToAdd, filesToDelete, filesToSync } = await compareDirectories(sourceDir, targetDir, targetLang);

            // --- 1. Add missing files (Translate WHOLE file if enabled) ---
            for (const filename of filesToAdd) {
                const sourceFilePath = path.join(sourceDir, filename);
                const targetFilePath = path.join(targetDir, filename);
                const action = enableTranslation ? 'Adding & Translating file (whole JSON):' : 'Adding file:';
                console.log(`  ➕ ${action} ${targetLang}/${filename}`);
                try {
                    const sourceContent = await fs.readFile(sourceFilePath, 'utf-8');
                    const sourceJson = JSON.parse(sourceContent);

                    let targetJson;
                    if (enableTranslation) {
                        // Use whole file translator here
                        targetJson = await translateJsonFileContent(sourceJson, sourceLang, targetLang);
                    } else {
                        targetJson = createEmptyStructure(sourceJson);
                    }

                    await fs.writeFile(targetFilePath, JSON.stringify(targetJson, null, 2), 'utf-8');
                    langChangesCount++;
                    // TODO: Add AST update call here if needed for added files

                } catch (error) {
                    console.error(`    ❌ Error adding file ${filename} for ${targetLang}: ${error.message}`);
                }
            }

            // --- 2. Delete extra files ---
            for (const filename of filesToDelete) {
                const targetFilePath = path.join(targetDir, filename);
                console.log(`  ➖ Deleting file: ${targetLang}/${filename}`);
                try {
                    await fs.unlink(targetFilePath);
                    langChangesCount++;
                    if (attemptAutoUpdate && absoluteConfigFile && configDir) {
                        await removeEntryFromI18nConfig(absoluteConfigFile, targetLang, filename, configDir, baseDir);
                    }
                } catch (error) {
                    console.error(`    ❌ Error deleting file ${filename} for ${targetLang} or updating config: ${error.message}`);
                }
            }

            // --- 3. Sync structure of existing files AND translate added parts ---
            for (const filename of filesToSync) {
                const sourceFilePath = path.join(sourceDir, filename);
                const targetFilePath = path.join(targetDir, filename);
                let writeNeeded = false; // Flag to track if file needs saving
                let structureChanged = false; // Flag specific to structural sync result
                let translationApplied = false; // Flag if translations were injected

                try {
                    const sourceContent = await fs.readFile(sourceFilePath, 'utf-8');
                    const targetContent = await fs.readFile(targetFilePath, 'utf-8');
                    const sourceJson = JSON.parse(sourceContent);
                    let originalTargetJson;

                    try {
                        originalTargetJson = JSON.parse(targetContent);
                    } catch (parseError) {
                        console.warn(`    ⚠️ Invalid JSON in target file ${targetFilePath}. Overwriting with ${enableTranslation ? 'translated' : 'empty'} source structure. Error: ${parseError.message}`);
                        const replacementJson = enableTranslation
                            ? await translateJsonFileContent(sourceJson, sourceLang, targetLang) // Translate whole file on error
                            : createEmptyStructure(sourceJson);
                        await fs.writeFile(targetFilePath, JSON.stringify(replacementJson, null, 2), 'utf-8');
                        langChangesCount++;
                        continue; // Move to next file
                    }

                    // Perform recursive structure-only synchronization
                    // It collects info about added nodes into addedNodesCollector
                    const addedNodesCollector = [];
                    const syncResult = syncStructure(
                        sourceJson,
                        originalTargetJson,
                        'root',
                        addedNodesCollector // Pass array to collect additions
                    );

                    let finalTargetJson = syncResult.updatedNode; // Start with the structurally synced node
                    structureChanged = syncResult.changesMade; // Store if structure was altered

                    // If structural changes occurred AND translation is enabled AND nodes were added
                    if (structureChanged && enableTranslation && addedNodesCollector.length > 0) {
                        console.log(`    ⚙️ Translating ${addedNodesCollector.length} added structure(s)/key(s) for ${targetLang}/${filename}...`);

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
                                // console.log(`      ✅ Injected translation at: ${addedInfo.path}`);
                            } catch (translateError) {
                                console.error(`    ❌ Error translating added fragment at path ${addedInfo.path}: ${translateError.message}`);
                                // Keep the empty structure that syncStructure inserted as fallback
                            }
                        }
                        if (translationApplied) {
                            console.log(`    ✅ Finished translating added part(s) for ${targetLang}/${filename}.`);
                        }
                    }

                    // Determine if writing is needed (structure changed OR translation was applied)
                    writeNeeded = structureChanged || translationApplied;

                    if (writeNeeded) {
                        if (translationApplied) {
                            // Log specific message if translation occurred
                            console.log(`    ✏️ Applying structural changes AND injected translations to ${targetLang}/${filename}.`);
                        } else if (structureChanged) {
                            // Log if only structure changed
                            console.log(`    ✏️ Applying structural key additions/deletions to ${targetLang}/${filename}.`);
                        }
                        await fs.writeFile(targetFilePath, JSON.stringify(finalTargetJson, null, 2), 'utf-8');
                        langChangesCount++; // Count sync+translate as one operation for summary
                    } else {
                        console.log(`    ✨ No structural changes or translations needed for ${targetLang}/${filename}.`);
                    }

                } catch (error) {
                    console.error(`    ❌ Error syncing file ${filename} for ${targetLang}: ${error.message}`);
                }
            } // End loop filesToSync

            // Log summary for the current language
            if (langChangesCount > 0) {
                console.log(`  Finished syncing ${targetLang}. Operations performed: ${langChangesCount}`);
                totalChangesCount += langChangesCount;
            } else {
                console.log(`  Finished syncing ${targetLang}. No operations were needed.`);
            }

        } catch (error) {
            console.error(`❌ Failed to sync language ${targetLang}: ${error.message}`);
        }
    } // End loop targetLangs

    // Final summary log
    if (totalChangesCount > 0) {
        console.log(`\n✅ Synchronization complete. Approximately ${totalChangesCount} operations performed across target languages.`);
    } else {
        console.log(`\n✅ Synchronization complete. No operations were needed.`);
    }
}