// fileOperations.js
import fs from 'fs/promises';
import path from 'path';
import { createEmptyStructure } from './utils.js';
import { translateJsonFileContent } from './translator.js';

export async function getSourceFiles(sourceDir) {
    try {
        const entries = await fs.readdir(sourceDir, { withFileTypes: true });
        const sourceFiles = entries
            .filter(dirent => dirent.isFile() && dirent.name.endsWith('.json'))
            .map(dirent => dirent.name);

        if (sourceFiles.length === 0) {
            console.warn(`⚠️ No JSON files found in ${sourceDir}.`);
        } else {
            console.log(`Found ${sourceFiles.length} source JSON file(s): ${sourceFiles.join(', ')}`);
        }
        return sourceFiles;

    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Source directory not found: ${sourceDir}`);
        } else if (error.code === 'EACCES') {
            throw new Error(`Permission denied reading directory: ${sourceDir}`);
        } else {
            console.error(`Unexpected error reading source directory ${sourceDir}:`, error);
            throw new Error(`Failed to read source directory ${sourceDir}.`);
        }
    }
}

export async function processLanguage(targetLang, targetDir, sourceDir, sourceFiles, enableTranslation, sourceLangCode) {
    const mode = enableTranslation ? 'Translating (Whole JSON Mode)' : 'Generating Empty Structure for';
    console.log(`\n${mode} language: ${targetLang} (Output directory: ${targetDir})`);
    let allFilesAttemptedSuccessfully = true;
    let filesProcessedCount = 0;

    try {
        await fs.mkdir(targetDir, { recursive: true });
        console.log(`  Ensured directory exists: ${targetDir}`);
    } catch (error) {
        console.error(`❌ Error creating directory ${targetDir}: ${error.message}`);
        return false;
    }

    // If there were no source files found earlier, we're done for this language
    if (!sourceFiles || sourceFiles.length === 0) {
        console.log(`  No source files to process for ${targetLang}.`);
        return true;
    }

    for (const filename of sourceFiles) {
        const sourceFilePath = path.join(sourceDir, filename);
        const targetFilePath = path.join(targetDir, filename);

        try {
            console.log(`  Processing file: ${filename}`);

            const sourceContent = await fs.readFile(sourceFilePath, 'utf-8');

            let sourceJson;
            try {
                sourceJson = JSON.parse(sourceContent);
            } catch (parseError) {
                console.error(`    ❌ Error parsing JSON in source file ${sourceFilePath}: ${parseError.message}`);
                allFilesAttemptedSuccessfully = false;
                continue;
            }

            let targetJson;
            if (enableTranslation) {
                targetJson = await translateJsonFileContent(sourceJson, sourceLangCode, targetLang);
            } else {
                targetJson = createEmptyStructure(sourceJson);
            }
            await fs.writeFile(targetFilePath, JSON.stringify(targetJson, null, 2), 'utf-8');
            console.log(`    ✅ Wrote file: ${targetFilePath}`);
            filesProcessedCount++;

        } catch (fileError) {
            console.error(`    ❌ Error processing file ${filename} for ${targetLang}: ${fileError.message}`);
            allFilesAttemptedSuccessfully = false; // Mark language processing as partially failed
        }
    }

    if (!allFilesAttemptedSuccessfully) {
        console.warn(`    ⚠️ Some files encountered errors during processing for language '${targetLang}'.`);
    } else {
        console.log(`  Successfully processed ${filesProcessedCount} files for ${targetLang}.`);
    }

    return true;
}