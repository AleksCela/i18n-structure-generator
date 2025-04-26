// fileOperations.js
import fs from 'fs/promises';
import path from 'path';
import { createEmptyStructure } from './utils.js';
// Import the whole-JSON translator function
import { translateJsonFileContent } from './translator.js';

/**
 * Reads the source directory and returns a list of JSON filenames found.
 * Handles errors like directory not found or permission issues.
 *
 * @param {string} sourceDir - Absolute path to the source language directory.
 * @returns {Promise<string[]>} - Array of JSON filenames found. Returns empty array if dir exists but no JSON files found.
 * @throws {Error} If directory cannot be accessed (excluding ENOENT which throws specific error).
 */
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
        return sourceFiles; // Returns empty array if no JSON files found

    } catch (error) {
        if (error.code === 'ENOENT') {
            // Directory does not exist
            throw new Error(`Source directory not found: ${sourceDir}`);
        } else if (error.code === 'EACCES') {
            // Permission denied
            throw new Error(`Permission denied reading directory: ${sourceDir}`);
        } else {
            // Other unexpected errors
            console.error(`Unexpected error reading source directory ${sourceDir}:`, error);
            throw new Error(`Failed to read source directory ${sourceDir}.`);
        }
    }
}

/**
 * Processes a single target language for the 'generate' command.
 * Creates the target directory and generates/overwrites JSON files based on source files.
 * If translation is enabled, it attempts to translate the entire JSON content using
 * the configured translator function (`translateJsonFileContent`). Otherwise, it creates
 * files with an empty structure matching the source.
 *
 * @param {string} targetLang - The target language code (e.g., 'fr').
 * @param {string} targetDir - Absolute path to the target language directory to be created/used.
 * @param {string} sourceDir - Absolute path to the source language directory.
 * @param {string[]} sourceFiles - List of source JSON filenames to process.
 * @param {boolean} enableTranslation - Flag indicating if translation should be performed.
 * @param {string} sourceLangCode - Source language code (required if translation is enabled).
 * @returns {Promise<boolean>} - True if the directory creation was successful and file processing loop completed
 * (even if individual files had errors), false if directory creation failed.
 */
export async function processLanguage(targetLang, targetDir, sourceDir, sourceFiles, enableTranslation, sourceLangCode) {
    const mode = enableTranslation ? 'Translating (Whole JSON Mode)' : 'Generating Empty Structure for';
    console.log(`\n${mode} language: ${targetLang} (Output directory: ${targetDir})`);
    let allFilesAttemptedSuccessfully = true; // Tracks if *all* files were processed without error
    let filesProcessedCount = 0; // Tracks how many files were successfully written

    // 1. Ensure target directory exists before processing files
    try {
        await fs.mkdir(targetDir, { recursive: true });
        console.log(`  Ensured directory exists: ${targetDir}`);
    } catch (error) {
        console.error(`❌ Error creating directory ${targetDir}: ${error.message}`);
        return false; // Cannot proceed with this language if directory creation fails
    }

    // If there were no source files found earlier, we're done for this language
    if (!sourceFiles || sourceFiles.length === 0) {
        console.log(`  No source files to process for ${targetLang}.`);
        return true; // Directory ensured, so operation is considered 'complete'
    }

    // 2. Process each source file: Read, Transform (Translate or Empty), Write
    for (const filename of sourceFiles) {
        const sourceFilePath = path.join(sourceDir, filename);
        const targetFilePath = path.join(targetDir, filename);

        try {
            // Log which file is being processed
            console.log(`  Processing file: ${filename}`);

            // Read the content of the source file
            const sourceContent = await fs.readFile(sourceFilePath, 'utf-8');

            // Parse the source file content as JSON
            let sourceJson;
            try {
                sourceJson = JSON.parse(sourceContent);
            } catch (parseError) {
                // If source JSON is invalid, log error and skip this file
                console.error(`    ❌ Error parsing JSON in source file ${sourceFilePath}: ${parseError.message}`);
                allFilesAttemptedSuccessfully = false; // Mark language as partially failed
                continue; // Move to the next source file
            }

            // --- Determine Target Content (Translate or Create Empty) ---
            let targetJson;
            if (enableTranslation) {
                // Call the translator function which handles the whole JSON object
                // This function should return the translated JSON or an empty structure on failure
                targetJson = await translateJsonFileContent(sourceJson, sourceLangCode, targetLang);
            } else {
                // If translation is disabled, create the empty structure
                targetJson = createEmptyStructure(sourceJson);
            }
            // ----------------------------------------------------------

            // Write the resulting target JSON (translated or empty) to the target file
            // Use indentation (null, 2) for pretty printing
            await fs.writeFile(targetFilePath, JSON.stringify(targetJson, null, 2), 'utf-8');
            console.log(`    ✅ Wrote file: ${targetFilePath}`);
            filesProcessedCount++;

        } catch (fileError) {
            // Catch errors during read, translation call (if enabled), or write for this specific file
            console.error(`    ❌ Error processing file ${filename} for ${targetLang}: ${fileError.message}`);
            allFilesAttemptedSuccessfully = false; // Mark language processing as partially failed
            // Continue processing other files for this language
        }
    } // End loop through sourceFiles

    // Log a summary message if any file encountered errors for this language
    if (!allFilesAttemptedSuccessfully) {
        console.warn(`    ⚠️ Some files encountered errors during processing for language '${targetLang}'.`);
    } else {
        console.log(`  Successfully processed ${filesProcessedCount} files for ${targetLang}.`);
    }

    // Return true indicating the overall process for the language directory completed,
    // even if some individual file operations failed. The caller can use other metrics
    // like languagesFullyProcessed array if needed.
    return true;
}