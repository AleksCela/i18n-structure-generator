// syncOperations.js
import fs from 'fs/promises';
import path from 'path';
import { createEmptyStructure, syncStructure, setValueAtPath } from './utils.js';
import { translateJsonFileContent, translateStructureInBatches } from './translator.js';

async function compareDirectories(sourceDir, targetDir, targetLang) {
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


export async function runSync(baseDir, sourceLang, targetLangs, enableTranslation, attemptAutoUpdate, absoluteConfigFile, configDir) {
    const mode = enableTranslation ? 'Translation & Sync' : 'Sync';
    console.log(`\n🔄 Starting Structure ${mode}...`);
    const sourceDir = path.join(baseDir, sourceLang);
    let totalChangesCount = 0; 

    for (const targetLang of targetLangs) {
        if (targetLang === sourceLang) {
            console.log(`\nSkipping sync for source language: ${targetLang}`);
            continue;
        }

        console.log(`\nSyncing language: ${targetLang}`);
        const targetDir = path.join(baseDir, targetLang);
        let langChangesCount = 0; 

        try {
            const { filesToAdd, filesToDelete, filesToSync } = await compareDirectories(sourceDir, targetDir, targetLang);

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
                        targetJson = await translateJsonFileContent(sourceJson, sourceLang, targetLang);
                    } else {
                        targetJson = createEmptyStructure(sourceJson);
                    }

                    await fs.writeFile(targetFilePath, JSON.stringify(targetJson, null, 2), 'utf-8');
                    langChangesCount++;

                } catch (error) {
                    console.error(`    ❌ Error adding file ${filename} for ${targetLang}: ${error.message}`);
                }
            } 

            for (const filename of filesToDelete) {
                const targetFilePath = path.join(targetDir, filename);
                console.log(`  ➖ Deleting file: ${targetLang}/${filename}`);
                try {
                    await fs.unlink(targetFilePath);
                    langChangesCount++;
                } catch (error) {
                    console.error(`    ❌ Error deleting file ${filename} for ${targetLang}: ${error.message}`);
                }
            } 

            for (const filename of filesToSync) {
                const sourceFilePath = path.join(sourceDir, filename);
                const targetFilePath = path.join(targetDir, filename);
                let writeNeeded = false; 
                let structureChanged = false; 
                let translationApplied = false;
;
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
                            ? await translateJsonFileContent(sourceJson, sourceLang, targetLang) 
                            : createEmptyStructure(sourceJson);
                        await fs.writeFile(targetFilePath, JSON.stringify(replacementJson, null, 2), 'utf-8');
                        langChangesCount++;
                        continue; 
                    }

                    const addedNodesCollector = [];
                    const syncResult = syncStructure(
                        sourceJson,
                        originalTargetJson,
                        'root',
                        addedNodesCollector 
                    );

                    let finalTargetJson = syncResult.updatedNode; 
                    structureChanged = syncResult.changesMade; 

                    if (structureChanged && enableTranslation && addedNodesCollector.length > 0) {
                        console.log(`    ⚙️ Translating ${addedNodesCollector.length} added structure(s)/key(s) for ${targetLang}/${filename}...`);
                        writeNeeded = true; 

                        for (const addedInfo of addedNodesCollector) {
                            try {
                                const translatedValueFragment = await translateStructureInBatches(
                                    addedInfo.sourceValue,
                                    sourceLang,
                                    targetLang
                                );
                                setValueAtPath(finalTargetJson, addedInfo.path, translatedValueFragment);
                                translationApplied = true;
                            } catch (translateError) {
                                console.error(`    ❌ Error translating added fragment at path ${addedInfo.path}: ${translateError.message}`);
                            }
                        } 
                        if (translationApplied) {
                            console.log(`    ✅ Finished translating added part(s) for ${targetLang}/${filename}.`);
                        }
                    }

                    writeNeeded = structureChanged; 

                    if (writeNeeded) {
                        if (translationApplied) {
                            console.log(`    ✏️ Applying structural changes AND injected translations to ${targetLang}/${filename}.`);
                        } else if (structureChanged) {
                            console.log(`    ✏️ Applying structural key additions/deletions to ${targetLang}/${filename}.`);
                        }
                        await fs.writeFile(targetFilePath, JSON.stringify(finalTargetJson, null, 2), 'utf-8');
                        langChangesCount++; 
                    } else {
                        console.log(`    ✨ No structural changes or translations needed for ${targetLang}/${filename}.`);
                    }

                } catch (error) {
                    console.error(`    ❌ Error syncing file ${filename} for ${targetLang}: ${error.message}`);
                }
            } 
            if (langChangesCount > 0) {
                console.log(`  Finished syncing ${targetLang}. Operations performed: ${langChangesCount}`);
                totalChangesCount += langChangesCount; 
            } else {
                console.log(`  Finished syncing ${targetLang}. No operations were needed.`);
            }

        } catch (error) {
            console.error(`❌ Failed to sync language ${targetLang}: ${error.message}`);
        }
    }

    if (totalChangesCount > 0) {
        console.log(`\n✅ Synchronization complete. Approximately ${totalChangesCount} operations performed across target languages.`);
    } else {
        console.log(`\n✅ Synchronization complete. No structural operations were needed.`);
    }
}