#!/usr/bin/env node

import fs from 'fs/promises'; // Keep fs import needed for directory checks
import path from 'path';
import inquirer from 'inquirer';
// Import necessary functions from modules
import { getBaseInputs } from './prompts.js'; // Removed unused prompt imports
import { getSourceFiles, processLanguage } from './fileOperations.js';
// Removed astUpdater imports
import { runSync } from './syncOperations.js';
import { normalizeImportPath, generateImportName } from './utils.js';
// Import translator initialization function only
import { initializeTranslator } from './translator.js';

/**
 * Executes the 'generate' command logic. Creates/overwrites target files
 * with empty structure or translated content based on source.
 *
 * @param {object} config - Base configuration object from prompts.
 * @param {boolean} enableTranslation - Whether translation was successfully initialized.
 */
async function runGenerate(config, enableTranslation) { // Removed config file params
    const { baseDir, sourceLang, targetLangsString: targetLangs } = config;
    const absoluteBaseDir = path.resolve(process.cwd(), baseDir);
    const sourceDir = path.join(absoluteBaseDir, sourceLang);

    const mode = enableTranslation ? 'Translation (Whole JSON Mode)' : 'Generation';
    console.log(`\nRunning Structure ${mode}`);
    console.log(`Source directory: ${sourceDir} (using language code: ${sourceLang})`);
    console.log(`Target languages: ${targetLangs.join(', ')}`);
    // Removed logging about config file updates

    if (targetLangs.includes(sourceLang)) {
        console.warn(`\n⚠️ Warning: Source language '${sourceLang}' is also listed as a target language.`);
        console.warn(`   Files in '${sourceDir}' may be overwritten during structure generation.`);
    }

    // --- Get Source Files ---
    let sourceFiles;
    let sourceFilesFound = false;
    try {
        sourceFiles = await getSourceFiles(sourceDir);
        if (sourceFiles && sourceFiles.length > 0) {
            sourceFilesFound = true;
        } else {
            console.log("\nNo source JSON files found to process.");
            sourceFiles = [];
        }
    } catch (error) {
        if (error.message.includes("Source directory not found")) {
            console.error(`\n❌ Error: ${error.message}`);
            console.log("   Cannot generate files without a source directory. Exiting.");
            process.exit(1);
        } else {
            console.error(`\n❌ Initialization failed: ${error.message}`);
            throw error;
        }
    }

    // --- Process Target Languages ---
    let filesProcessedTotal = 0;
    const languagesFullyProcessed = [];

    console.log("Ensuring target directories exist...");
    let dirCreationSuccess = true;
    for (const targetLang of targetLangs) {
        const targetDir = path.join(absoluteBaseDir, targetLang);
        try {
            await fs.mkdir(targetDir, { recursive: true });
        } catch (error) {
            console.error(`❌ Error creating directory ${targetDir}: ${error.message}`);
            dirCreationSuccess = false;
        }
    }

    if (dirCreationSuccess && sourceFilesFound) {
        console.log("Processing target language files...");
        for (const targetLang of targetLangs) {
            const targetDir = path.join(absoluteBaseDir, targetLang);
            try {
                const success = await processLanguage(
                    targetLang,
                    targetDir,
                    sourceDir,
                    sourceFiles,
                    enableTranslation,
                    sourceLang
                );
                if (success) {
                    languagesFullyProcessed.push(targetLang);
                    filesProcessedTotal += sourceFiles.length;
                }
            } catch (error) {
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

    // --- Manual Config Update Guidance ---
    // Display this if new languages/files were potentially created
    if (languagesFullyProcessed.length > 0 && sourceFilesFound) {
        console.log("\n✨ Manual Action Required ✨");
        console.log("   Remember to manually update your main i18n configuration file (e.g., i18n.js/ts)");
        console.log("   to import the newly created/updated files and add them to your resources object.");
        console.log("   Example for added languages/files:");
        languagesFullyProcessed.forEach(lang => {
            console.log(`     - Language: ${lang}`);
            if (sourceFiles.length > 0) {
                const exampleFile = sourceFiles[0]; // Show example for first file
                // Need configDir to show relative path - how to get it without prompt?
                // Let's assume config is often in src/ or similar relative to baseDir
                // This is imperfect guidance without knowing the config file location.
                const exampleTargetFilePath = path.join(baseDir, lang, exampleFile); // Use relative baseDir
                const exampleRelativePath = normalizeImportPath(`./${exampleTargetFilePath}`); // Simplistic relative path
                const importName = generateImportName(lang, exampleFile);
                const resourceKey = path.basename(exampleFile, '.json');
                console.log(`       import ${importName} from '${exampleRelativePath}';`);
                console.log(`       ... add to resources: ${lang}: { ${resourceKey}: ${importName}, ... } ...`);
            }
        });
    }
}


/**
 * Main execution function: determines command, gets inputs, calls appropriate handler.
 */
async function main() {
    const args = process.argv.slice(2);
    const isSyncCommand = args.includes('sync');
    const commandName = isSyncCommand ? 'Synchronization' : 'Generation';

    console.log(`🚀 Starting i18n Structure ${commandName}...`);

    // 1. Get Base Config
    const baseConfig = await getBaseInputs();

    // 2. Ask about Translation
    let translationInitialized = false;
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
                message: 'Enter your Google AI API Key (e.g., GEMINI_API_KEY):',
                mask: '*',
                validate: input => input && input.trim().length > 0 || 'API Key cannot be empty.',
            }
        ]);
        const apiKey = googleApiKey.trim();
        try {
            initializeTranslator(apiKey);
            translationInitialized = true;
            console.log("✅ Translator initialized successfully.");
        } catch (initError) {
            console.error(`\n❌ ${initError.message}`);
            console.warn("   Translation will be disabled due to initialization error.");
            translationInitialized = false;
        }
    } else {
        console.log("ℹ️ Translation disabled.");
    }

    // 3. No longer asking about Auto Update or Config File Path

    // 4. Execute Command
    if (isSyncCommand) {
        const absoluteBaseDir = path.resolve(process.cwd(), baseConfig.baseDir);
        await runSync(
            absoluteBaseDir,
            baseConfig.sourceLang,
            baseConfig.targetLangsString, // Prompt filter created the array
            translationInitialized // Pass boolean flag
            // Removed config file params
        );
    } else {
        await runGenerate(
            baseConfig,
            translationInitialized // Pass boolean flag
            // Removed config file params
        );
    }

    console.log("\n✅ Script finished.");
}


// --- Script Entry Point ---
main().catch(error => {
    console.error("\n❌ An unexpected critical error occurred:", error.message);
    console.error(error.stack);
    process.exit(1);
});