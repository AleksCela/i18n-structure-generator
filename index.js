#!/usr/bin/env node

import path from 'path';
import inquirer from 'inquirer'; // Make sure inquirer is imported here
import { getBaseInputs, askAttemptAutoUpdate, getConfigFileInput, confirmConfigFileUpdate } from './prompts.js';
import { getSourceFiles, processLanguage } from './fileOperations.js';
import { updateI18nConfigFile, removeEntryFromI18nConfig } from './astUpdater.js';
import { runSync } from './syncOperations.js';
import { normalizeImportPath, generateImportName } from './utils.js';

/**
 * Executes the 'generate' command logic: creates/overwrites target files
 * with empty structure based on source, optionally updates config file.
 *
 * @param {object} config - Configuration object from prompts.
 * @param {boolean} attemptAutoUpdate - Whether user wants to try updating config file.
 * @param {string | null} absoluteConfigFile - Absolute path to config file, or null.
 * @param {string | null} configDir - Absolute path to config file's directory, or null.
 */
async function runGenerate(config, attemptAutoUpdate, absoluteConfigFile, configDir) {
    const { baseDir, sourceLang, targetLangsString: targetLangs, configFile } = config; // configFile is relative path or null
    const absoluteBaseDir = path.resolve(process.cwd(), baseDir);
    const sourceDir = path.join(absoluteBaseDir, sourceLang);
    // absoluteConfigFile and configDir are passed in

    console.log(`\nSource directory: ${sourceDir} (using language code: ${sourceLang})`);
    console.log(`Target languages: ${targetLangs.join(', ')}`);
    if (absoluteConfigFile) {
        console.log(`i18n config file specified: ${absoluteConfigFile}`);
    } else if (attemptAutoUpdate) {
        // Should not happen if attemptAutoUpdate is true, but as safety log
        console.log(`i18n config file path was not provided or invalid.`);
    } else {
        console.log(`Automatic i18n config file update: Skipped by user.`);
    }


    if (targetLangs.includes(sourceLang)) {
        console.warn(`\n⚠️ Warning: Source language '${sourceLang}' is also listed as a target language.`);
        console.warn(`   Files in '${sourceDir}' may be overwritten during structure generation.`);
    }

    // --- Get Source Files ---
    let sourceFiles;
    try {
        sourceFiles = await getSourceFiles(sourceDir); // From fileOperations.js
        // If no source files, we can still proceed but won't generate anything
        if (sourceFiles.length === 0) {
            console.log("\nNo source JSON files found to process.");
            // Continue to allow directory creation if needed, but generation part ends here effectively.
        }
    } catch (error) {
        console.error(`\n❌ Initialization failed: ${error.message}`);
        throw error; // Propagate to main handler
    }

    // --- Process Target Languages (Generate/Overwrite) ---
    let filesCreatedTotal = 0;
    const languagesFullyProcessed = []; // Track languages where processLanguage completed fully

    for (const targetLang of targetLangs) {
        const targetDir = path.join(absoluteBaseDir, targetLang);
        try {
            // processLanguage creates/overwrites based on source
            const success = await processLanguage(targetLang, targetDir, sourceDir, sourceFiles);
            if (success && sourceFiles.length > 0) { // Only count if files were actually processed
                languagesFullyProcessed.push(targetLang);
                filesCreatedTotal += sourceFiles.length; // Rough count
            } else if (success && sourceFiles.length === 0) {
                // Language processed (directory created), but no files generated
                languagesFullyProcessed.push(targetLang); // Still consider it processed for consistency
            }
            // If success is false, processLanguage logged the critical error (e.g., mkdir failed)
        } catch (error) {
            // Catch unexpected errors from processLanguage itself
            console.error(`\n❌ Unexpected error generating structure for language ${targetLang}: ${error.message}`);
        }
    }

    console.log(`\n🎉 File structure generation complete.`);
    if (filesCreatedTotal > 0) {
        console.log(`  Created/updated structure for ${filesCreatedTotal} files across ${languagesFullyProcessed.length} languages.`);
    } else {
        console.log(`  Target directories ensured/checked for ${targetLangs.length} languages. No source files to generate.`);
    }


    // --- Update Config File ---
    // Only attempt if user opted-in, a valid config path exists, and some languages were processed
    if (attemptAutoUpdate && absoluteConfigFile && languagesFullyProcessed.length > 0 && sourceFiles.length > 0) {
        try {
            // Confirm before making changes
            const doUpdate = await confirmConfigFileUpdate(configFile, languagesFullyProcessed); // Use relative path for prompt message

            if (doUpdate) {
                // Call AST updater to add new entries
                await updateI18nConfigFile(absoluteConfigFile, absoluteBaseDir, languagesFullyProcessed, sourceFiles);
            } else {
                console.log("\nℹ️ Skipping i18n configuration file update as requested by user confirmation.");
                // Provide manual update guidance...
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
        if (languagesFullyProcessed.length === 0) {
            console.log("\nℹ️ No languages were fully processed, skipping configuration file update.");
        } else if (sourceFiles.length === 0) {
            console.log("\nℹ️ No source files found, skipping configuration file update.");
        }
    }
    // No message needed if !attemptAutoUpdate, already logged earlier.
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

    // 2. Ask about Config File Update Intent
    const attemptAutoUpdate = await askAttemptAutoUpdate();

    // 3. Get Config File Path ONLY if user opted-in
    let configFile = null; // Relative path for display/prompts
    let absoluteConfigFile = null;
    let configDir = null;
    if (attemptAutoUpdate) {
        configFile = await getConfigFileInput(); // Gets relative path
        absoluteConfigFile = path.resolve(process.cwd(), configFile);
        configDir = path.dirname(absoluteConfigFile);
    }

    // Combine base config and potentially the config file path
    // Note: targetLangsString is used here, but individual functions might use the filtered array directly
    const fullConfig = { ...baseConfig, configFile };

    // 4. Execute Command
    if (isSyncCommand) {
        const absoluteBaseDir = path.resolve(process.cwd(), fullConfig.baseDir);
        // Pass attemptAutoUpdate flag and absolute config paths to runSync
        await runSync(
            absoluteBaseDir,
            fullConfig.sourceLang,
            fullConfig.targetLangsString, // runSync expects array, filter is applied in prompt already
            attemptAutoUpdate,
            absoluteConfigFile,
            configDir
        );
    } else {
        // Pass attemptAutoUpdate flag and absolute config paths to runGenerate
        await runGenerate(
            fullConfig,
            attemptAutoUpdate,
            absoluteConfigFile,
            configDir
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