// fileOperations.js
import fs from 'fs/promises';
import path from 'path';
import { createEmptyStructure } from './utils.js'; // Use the corrected function

/**
 * Reads the source directory and returns a list of JSON filenames found.
 *
 * @param {string} sourceDir - Absolute path to the source language directory.
 * @returns {Promise<string[]>} - Array of JSON filenames.
 * @throws {Error} If directory not found or not readable (excluding ENOENT which is handled).
 */
export async function getSourceFiles(sourceDir) {
    try {
        const entries = await fs.readdir(sourceDir, { withFileTypes: true });
        const sourceFiles = entries
            .filter(dirent => dirent.isFile() && dirent.name.endsWith('.json'))
            .map(dirent => dirent.name);

        if (sourceFiles.length === 0) {
            // It's not necessarily an error, just might be nothing to process
            console.warn(`⚠️ No JSON files found in ${sourceDir}.`);
        } else {
            console.log(`Found source JSON files: ${sourceFiles.join(', ')}`);
        }
        return sourceFiles;

    } catch (error) {
        if (error.code === 'ENOENT') {
            // Let the caller handle ENOENT specifically if needed
            throw new Error(`Source directory not found: ${sourceDir}`);
        } else if (error.code === 'EACCES') {
            throw new Error(`Permission denied reading directory: ${sourceDir}`);
        } else {
            // Log unexpected errors
            console.error(`Unexpected error reading source directory ${sourceDir}:`, error);
            throw new Error(`Failed to read source directory ${sourceDir}.`);
        }
    }
}

/**
 * Processes a single target language for the 'generate' command.
 * Creates the target directory and generates/overwrites empty JSON files based on source files.
 *
 * @param {string} targetLang - The target language code.
 * @param {string} targetDir - Absolute path to the target language directory.
 * @param {string} sourceDir - Absolute path to the source language directory.
 * @param {string[]} sourceFiles - List of source JSON filenames.
 * @returns {Promise<boolean>} - True if directory creation succeeded and all files were attempted (even if some failed), false otherwise.
 */
export async function processLanguage(targetLang, targetDir, sourceDir, sourceFiles) {
    console.log(`\nProcessing language: ${targetLang} (Output directory: ${targetDir})`);
    let allFilesAttemptedSuccessfully = true; // Track if we could process all files without critical errors
    let filesProcessedCount = 0;

    // 1. Ensure target directory exists
    try {
        await fs.mkdir(targetDir, { recursive: true });
        console.log(`  Ensured directory exists: ${targetDir}`);
    } catch (error) {
        console.error(`❌ Error creating directory ${targetDir}: ${error.message}`);
        return false; // Cannot proceed with this language if directory creation fails
    }

    // If there are no source files, we're done for this language
    if (sourceFiles.length === 0) {
        console.log(`  No source files to process for ${targetLang}.`);
        return true;
    }

    // 2. Process each source file
    for (const filename of sourceFiles) {
        const sourceFilePath = path.join(sourceDir, filename);
        const targetFilePath = path.join(targetDir, filename);

        try {
            console.log(`  Processing file: ${filename}`);
            // Read source file content
            const sourceContent = await fs.readFile(sourceFilePath, 'utf-8');

            // Parse source JSON
            let sourceJson;
            try {
                sourceJson = JSON.parse(sourceContent);
            } catch (parseError) {
                // Log error and skip this file, marking the language as partially failed
                console.error(`    ❌ Error parsing JSON in source file ${sourceFilePath}: ${parseError.message}`);
                allFilesAttemptedSuccessfully = false;
                continue; // Skip to the next file
            }

            // Create the empty structure based on the source
            const targetJson = createEmptyStructure(sourceJson);

            // Write the new empty structure to the target file (overwrite if exists)
            await fs.writeFile(targetFilePath, JSON.stringify(targetJson, null, 2), 'utf-8');
            console.log(`    ✅ Wrote empty structure: ${targetFilePath}`);
            filesProcessedCount++;

            // TODO (Future AI): Hook translation call here after file structure is created/verified
            // Example: await translateFile(targetFilePath, sourceLang, targetLang);


        } catch (fileError) {
            // Catch errors during read/write for this specific file
            console.error(`    ❌ Error processing file ${filename} for ${targetLang}: ${fileError.message}`);
            allFilesAttemptedSuccessfully = false; // Mark language as partially failed
            // Continue processing other files for this language
        }
    } // End loop through sourceFiles

    // Log if some files failed
    if (!allFilesAttemptedSuccessfully) {
        console.warn(`    ⚠️ Some files encountered errors during processing for language '${targetLang}'.`);
    } else {
        console.log(`  Successfully processed ${filesProcessedCount} files for ${targetLang}.`);
    }

    // Return true if directory creation succeeded and we looped through all files
    // even if some individual file operations failed. The caller can check languagesFullyProcessed.
    return true;
}