#!/usr/bin/env node

import fs from 'fs/promises'; // Ensure fs is imported
import path from 'path';
import inquirer from 'inquirer';
// Import necessary functions from modules
import { getBaseInputs, askAttemptAutoUpdate, getConfigFileInput, confirmConfigFileUpdate } from './prompts.js';
import { getSourceFiles, processLanguage } from './fileOperations.js';
import { updateI18nConfigFile, removeEntryFromI18nConfig } from './astUpdater.js';
import { runSync } from './syncOperations.js';
import { normalizeImportPath, generateImportName } from './utils.js';
// Import translator initialization function only
import { initializeTranslator } from './translator.js';

/**
 * Executes the 'generate' command logic: creates/overwrites target files
 * with empty structure or translated content (using whole JSON method) based on source,
 * optionally updates config file.
 *
 * @param {object} config - Base configuration object from prompts.
 * @param {boolean} enableTranslation - Whether translation was successfully initialized.
 * @param {boolean} attemptAutoUpdate - Whether user wants to try updating config file.
 * @param {string | null} absoluteConfigFile - Absolute path to config file, or null.
 * @param {string | null} configDir - Absolute path to config file's directory, or null.
 */
async function runGenerate(config, enableTranslation, attemptAutoUpdate, absoluteConfigFile, configDir) {
    const { baseDir, sourceLang, targetLangsString: targetLangs, configFile } = config; // configFile is relative path or null
    const absoluteBaseDir = path.resolve(process.cwd(), baseDir);
    const sourceDir = path.join(absoluteBaseDir, sourceLang);

    const mode = enableTranslation ? 'Translation (Whole JSON Mode)' : 'Generation';
    console.log(`\nRunning Structure ${mode}`);
    console.log(`Source directory: ${sourceDir} (using language code: ${sourceLang})`);
    console.log(`Target languages: ${targetLangs.join(', ')}`);
    // Log config file info based on user intent and successful path retrieval
    if (attemptAutoUpdate && absoluteConfigFile) {
        console.log(`i18n config file specified: ${absoluteConfigFile}`);
    } else if (attemptAutoUpdate && !absoluteConfigFile) {
        console.log(`Automatic i18n config file update: Enabled but no valid path provided or path validation failed.`);
    } else if (!attemptAutoUpdate) {
        console.log(`Automatic i18n config file update: Skipped by user.`);
    }

    // Warn if source is also a target
    if (targetLangs.includes(sourceLang)) {
        console.warn(`\n⚠️ Warning: Source language '${sourceLang}' is also listed as a target language.`);
        console.warn(`   Files in '${sourceDir}' may be overwritten during structure generation.`);
    }

    // --- Get Source Files ---
    let sourceFiles;
    let sourceFilesFound = false;
    try {
        sourceFiles = await getSourceFiles(sourceDir);
        // If files are found (array is not empty)
        if (sourceFiles && sourceFiles.length > 0) {
            sourceFilesFound = true;
        } else {
            console.log("\nNo source JSON files found to process.");
            sourceFiles = []; // Ensure it's an empty array if null/undefined/empty
        }
    } catch (error) {
        // Handle case where source directory doesn't exist
        if (error.message.includes("Source directory not found")) {
            console.error(`\n❌ Error: ${error.message}`);
            console.log("   Cannot generate files without a source directory. Exiting.");
            process.exit(1); // Exit if source dir is missing
        } else {
            // Handle other initialization errors
            console.error(`\n❌ Initialization failed: ${error.message}`);
            throw error; // Propagate other critical errors
        }
    }

    // --- Process Target Languages ---
    let filesProcessedTotal = 0;
    const languagesFullyProcessed = []; // Track languages where processing completed

    // Ensure target directories exist first
    console.log("Ensuring target directories exist...");
    let dirCreationSuccess = true; // Assume success initially
    for (const targetLang of targetLangs) {
        const targetDir = path.join(absoluteBaseDir, targetLang);
        try {
            // Use the imported 'fs' module here - THIS WAS THE FIX
            await fs.mkdir(targetDir, { recursive: true });
        } catch (error) {
            console.error(`❌ Error creating directory ${targetDir}: ${error.message}`);
            dirCreationSuccess = false; // Mark if any dir creation failed
        }
    }

    // Only proceed with file processing if directories seem okay and source files exist
    if (dirCreationSuccess && sourceFilesFound) {
        console.log("Processing target language files...");
        for (const targetLang of targetLangs) {
            const targetDir = path.join(absoluteBaseDir, targetLang);
            try {
                // Pass translation enable flag to processLanguage
                // processLanguage calls the appropriate translator now
                const success = await processLanguage(
                    targetLang,
                    targetDir,
                    sourceDir,
                    sourceFiles, // This is guaranteed to be an array now
                    enableTranslation, // Pass the boolean flag
                    sourceLang        // Pass source lang for translation context
                );
                if (success) { // processLanguage returns true if it completed without critical errors
                    languagesFullyProcessed.push(targetLang);
                    // Increment based on source files attempted for this language
                    filesProcessedTotal += sourceFiles.length;
                }
            } catch (error) {
                // Catch unexpected errors from processLanguage itself
                console.error(`\n❌ Unexpected error generating structure for language ${targetLang}: ${error.message}`);
            }
        } // End language loop
    } else if (!dirCreationSuccess) {
        console.error("❌ Cannot proceed with file processing due to directory creation errors.");
    }


    console.log(`\n🎉 File structure ${mode} complete.`);
    if (filesProcessedTotal > 0) {
        console.log(`  Processed structure for ${filesProcessedTotal} files across ${languagesFullyProcessed.length} successfully processed languages.`);
    } else if (!sourceFilesFound) {
        console.log(`  Source directory checked. No source files found to process.`);
        console.log(`  Target directories ensured/checked for ${targetLangs.length} languages.`);
    } else {
        console.log(`  Target directories ensured/checked for ${targetLangs.length} languages.`);
    }


    // --- Update Config File (Only applies to GENERATE mode and if conditions met) ---
    if (attemptAutoUpdate && absoluteConfigFile && languagesFullyProcessed.length > 0 && sourceFilesFound) {
        try {
            // Confirm before making changes
            const doUpdate = await confirmConfigFileUpdate(configFile, languagesFullyProcessed); // Use relative path for prompt message
            if (doUpdate) {
                // Call AST updater to add new entries
                await updateI18nConfigFile(absoluteConfigFile, absoluteBaseDir, languagesFullyProcessed, sourceFiles);
            } else {
                console.log("\nℹ️ Skipping i18n configuration file update as requested by user confirmation.");
                // Manual update guidance...
                console.log("    Remember to manually add the necessary imports and resource definitions for:");
                languagesFullyProcessed.forEach(lang => {
                    console.log(`      - Language: ${lang}`);
                    if (sourceFiles.length > 0) {
                        const exampleFile = sourceFiles[0];
                        const exampleTargetFilePath = path.join(absoluteBaseDir, lang, exampleFile);
                        const exampleRelativePath = normalizeImportPath(path.relative(configDir, exampleTargetFilePath));
                        const importName = generateImportName(lang, exampleFile);
                        const resourceKey = path.basename(exampleFile, '.json');
                        console.log(`        Example import: import ${importName} from './${exampleRelativePath}';`);
                        console.log(`        Example resource: ${lang}: { ${resourceKey}: ${importName}, ... }`);
                    }
                });
            }
        } catch (error) {
            // Catch errors specifically from the update process
            console.error(`\n❌ Failed to update configuration file: ${error.message}`);
            console.error("    Please review the errors above and update the file manually.");
        }
    } else if (attemptAutoUpdate && absoluteConfigFile) {
        // Log reasons for skipping config update if applicable
        if (languagesFullyProcessed.length === 0 && targetLangs.length > 0 && sourceFilesFound) {
            console.log("\nℹ️ No languages were fully processed (check file processing errors), skipping configuration file update.");
        } else if (!sourceFilesFound) {
            console.log("\nℹ️ No source files found, skipping configuration file update.");
        }
    }
    // No message needed if !attemptAutoUpdate, intent already logged.
}


/**
 * Main execution function: determines command, gets inputs, calls appropriate handler.
 */
async function main() {
    // Simple command parsing: check if 'sync' is passed as an argument
    const args = process.argv.slice(2); // Gets arguments after 'node index.js'
    const isSyncCommand = args.includes('sync');
    const commandName = isSyncCommand ? 'Synchronization' : 'Generation';

    console.log(`🚀 Starting i18n Structure ${commandName}...`);

    // 1. Get Base Config (Dirs, Languages) using prompts
    const baseConfig = await getBaseInputs();

    // 2. Ask about Translation and initialize if requested
    let translationInitialized = false; // Track if translator is ready
    const { enableTranslation } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'enableTranslation',
            message: `Do you want to translate content using Google AI for ${commandName}? (requires API key)`,
            default: false,
        }
    ]);

    if (enableTranslation) {
        const { googleApiKey } = await inquirer.prompt([
            {
                type: 'password',
                name: 'googleApiKey',
                message: 'Enter your Google AI API Key (e.g., GEMINI_API_KEY):', // Adjusted message slightly
                mask: '*',
                validate: input => input && input.trim().length > 0 || 'API Key cannot be empty.',
            }
        ]);
        const apiKey = googleApiKey.trim();
        try {
            // Attempt to initialize the translator module using user's syntax via translator.js
            initializeTranslator(apiKey); // Initialize with default model from user example
            translationInitialized = true; // Mark as successful
            console.log("✅ Translator initialized successfully.");
        } catch (initError) {
            console.error(`\n❌ ${initError.message}`);
            console.warn("   Translation will be disabled due to initialization error.");
            // Ensure flag remains false if init fails
            translationInitialized = false;
        }
    } else {
        console.log("ℹ️ Translation disabled.");
    }

    // 3. Ask about Config File Update Intent
    const attemptAutoUpdate = await askAttemptAutoUpdate();

    // 4. Get Config File Path ONLY if user opted-in
    let configFile = null; // Relative path for display/prompts
    let absoluteConfigFile = null;
    let configDir = null;
    if (attemptAutoUpdate) {
        try {
            // Use prompt function to get and validate path
            configFile = await getConfigFileInput();
            absoluteConfigFile = path.resolve(process.cwd(), configFile);
            configDir = path.dirname(absoluteConfigFile);
        } catch (error) {
            // Handle potential error during config file prompt/validation if needed
            console.error(`Error getting config file path: ${error.message}`);
            // Ensure these are null if we couldn't get the path
            configFile = null;
            absoluteConfigFile = null;
            configDir = null;
        }
    }

    // Combine base config and potentially the config file path
    // Note: targetLangsString from prompt is the array due to filter
    const fullConfig = { ...baseConfig, configFile };

    // 5. Execute the appropriate command based on args
    if (isSyncCommand) {
        const absoluteBaseDir = path.resolve(process.cwd(), fullConfig.baseDir);
        // Pass the boolean translationInitialized flag to runSync
        await runSync(
            absoluteBaseDir,
            fullConfig.sourceLang,
            fullConfig.targetLangsString, // This is already the array
            translationInitialized, // Pass boolean flag
            attemptAutoUpdate,
            absoluteConfigFile, // null if not provided/validated
            configDir           // null if not provided/validated
        );
    } else {
        // Pass the boolean translationInitialized flag to runGenerate
        await runGenerate(
            fullConfig,
            translationInitialized, // Pass boolean flag
            attemptAutoUpdate,
            absoluteConfigFile, // null if not provided/validated
            configDir           // null if not provided/validated
        );
    }

    console.log("\n✅ Script finished.");
}


// --- Script Entry Point ---
// Execute main function and catch any top-level unhandled errors
main().catch(error => {
    console.error("\n❌ An unexpected critical error occurred:", error.message);
    // Log the stack trace for detailed debugging information
    console.error(error.stack);
    process.exit(1); // Exit with a non-zero code to indicate failure
});