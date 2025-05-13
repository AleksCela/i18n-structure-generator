import dotenv from 'dotenv';
dotenv.config();


import fs from 'fs/promises';
import path from 'path';
import inquirer from 'inquirer';

import { getSourceFiles, processLanguage } from './fileOperations.js';
// Removed astUpdater imports
import { runSync } from './syncOperations.js';
// Import translator initialization function AND the counter getter
import { initializeTranslator, getApiCallCount } from './translator.js';


const CONFIG_FILE_NAME = '.i18n-generatorrc.json';

/**
 * Attempts to load configuration from the config file in the current directory.
 * @returns {Promise<object | null>} Configuration object or null if not found/error.
 */
async function loadConfig() {
    const configPath = path.join(process.cwd(), CONFIG_FILE_NAME);
    try {
        const configFileContent = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(configFileContent);
        console.log(`✅ Loaded configuration from ${CONFIG_FILE_NAME}`);
        return config;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`ℹ️ No ${CONFIG_FILE_NAME} found in current directory. Will use prompts.`);
        } else if (error instanceof SyntaxError) {
            console.warn(`⚠️ Error parsing ${CONFIG_FILE_NAME}: ${error.message}. Please check its JSON syntax. Falling back to prompts.`);
        } else {
            console.warn(`⚠️ Error reading ${CONFIG_FILE_NAME}: ${error.message}. Falling back to prompts.`);
        }
        return null;
    }
}

/**
 * Gets configuration, prioritizing config file, then prompts with defaults.
 * @param {object | null} loadedConfig - Config object loaded from file, or null.
 * @returns {Promise<object>} Final configuration object.
 */
async function getConfiguration(loadedConfig) {
    const config = loadedConfig || {}; // Use empty object if no config loaded
    const finalConfig = {};

    // --- Base Directory ---
    if (config.baseDir && typeof config.baseDir === 'string') {
        finalConfig.baseDir = config.baseDir;
        console.log(`   Using baseDir from config: ${finalConfig.baseDir}`);
    } else {
        const { baseDir } = await inquirer.prompt([{
            type: 'input', name: 'baseDir', message: 'Enter the base directory containing language folders:', default: './translations'
        }]);
        finalConfig.baseDir = baseDir;
    }

    // --- Source Language ---
    if (config.sourceLang && typeof config.sourceLang === 'string') {
        // TODO: Add validation here too? Or assume config is valid? Let's validate.
        const validator = (await import('./validators.js')).validateSourceLang;
        const validationResult = validator(config.sourceLang);
        if (validationResult === true) {
            finalConfig.sourceLang = config.sourceLang.toLowerCase();
            console.log(`   Using sourceLang from config: ${finalConfig.sourceLang}`);
        } else {
            console.warn(`   Invalid sourceLang '${config.sourceLang}' in config file: ${validationResult}. Prompting...`);
        }
    }
    // Prompt if not found or invalid in config
    if (!finalConfig.sourceLang) {
        const { sourceLang } = await inquirer.prompt([{
            type: 'input', name: 'sourceLang', message: 'Enter the source language code (ISO 639-1):',
            validate: (await import('./validators.js')).validateSourceLang, filter: input => input.trim().toLowerCase()
        }]);
        finalConfig.sourceLang = sourceLang;
    }


    // --- Target Languages ---
    if (Array.isArray(config.targetLangs) && config.targetLangs.length > 0) {
        // TODO: Add validation for each lang in the array?
        finalConfig.targetLangsString = config.targetLangs.map(l => l.toLowerCase()); // Assuming config array is valid
        console.log(`   Using targetLangs from config: ${finalConfig.targetLangsString.join(', ')}`);
    } else {
        const { targetLangsString } = await inquirer.prompt([{
            type: 'input', name: 'targetLangsString', message: 'Enter target language codes (ISO 639-1), comma-separated:',
            validate: (await import('./validators.js')).validateTargetLangs, filter: input => input.split(',').map(lang => lang.trim().toLowerCase()).filter(Boolean)
        }]);
        finalConfig.targetLangsString = targetLangsString; // Already an array from filter
    }

    // --- Translation Settings ---
    finalConfig.translation = { enable: false }; // Default disabled
    if (config.translation && typeof config.translation === 'object') {
        if (typeof config.translation.enable === 'boolean') {
            finalConfig.translation.enable = config.translation.enable;
            console.log(`   Using enableTranslation from config: ${finalConfig.translation.enable}`);
        }
        if (typeof config.translation.apiKeyEnvVar === 'string') {
            finalConfig.translation.apiKeyEnvVar = config.translation.apiKeyEnvVar;
            console.log(`   Using apiKeyEnvVar from config: ${finalConfig.translation.apiKeyEnvVar}`);
        }
        if (typeof config.translation.modelName === 'string') {
            finalConfig.translation.modelName = config.translation.modelName;
            console.log(`   Using modelName from config: ${finalConfig.translation.modelName}`);
        }
    }

    // Prompt for enabling translation ONLY if not specified in config
    if (config.translation?.enable === undefined) { // Check if 'enable' was explicitly missing
        const { enableTranslationPrompt } = await inquirer.prompt([{
            type: 'confirm', name: 'enableTranslationPrompt', message: `Do you want to translate content using Google AI?`, default: false,
        }]);
        finalConfig.translation.enable = enableTranslationPrompt;
    }

    // API Key Handling (Prompt only if enabled and not found via env var from config)
    finalConfig.apiKey = null; // Start with no key
    if (finalConfig.translation.enable) {
        let keyFound = false;
        if (finalConfig.translation.apiKeyEnvVar) {
            const keyFromEnv = process.env[finalConfig.translation.apiKeyEnvVar];
            if (keyFromEnv) {
                console.log(`   Using API Key from environment variable: ${finalConfig.translation.apiKeyEnvVar}`);
                finalConfig.apiKey = keyFromEnv;
                keyFound = true;
            } else {
                console.warn(`   ⚠️ Environment variable '${finalConfig.translation.apiKeyEnvVar}' (from config) not found.`);
            }
        }

        if (!keyFound) {
            // Prompt for key if translation enabled but not found via config's env var
            const { googleApiKey } = await inquirer.prompt([{
                type: 'password', name: 'googleApiKey', message: 'Enter your Google AI API Key:', mask: '*',
                validate: input => input && input.trim().length > 0 || 'API Key cannot be empty.',
            }]);
            finalConfig.apiKey = googleApiKey.trim();
        }
    }

    return finalConfig;
}


// runGenerate function remains the same...
/**
 * Executes the 'generate' command logic.
 * @param {object} config
 * @param {boolean} enableTranslation
 */
async function runGenerate(config, enableTranslation) {
    const { baseDir, sourceLang, targetLangsString: targetLangs } = config; // Extract from final config
    const absoluteBaseDir = path.resolve(process.cwd(), baseDir);
    const sourceDir = path.join(absoluteBaseDir, sourceLang);
    const mode = enableTranslation ? 'Translation (Whole JSON Mode)' : 'Generation';
    console.log(`\nRunning Structure ${mode}`);
    console.log(`Source directory: ${sourceDir} (using language code: ${sourceLang})`);
    console.log(`Target languages: ${targetLangs.join(', ')}`);
    console.log(`Automatic i18n config file update: Feature Removed.`);

    if (targetLangs.includes(sourceLang)) { console.warn(`\n⚠️ Warning: Source language '${sourceLang}' is also listed as a target language.`); console.warn(`   Files in '${sourceDir}' may be overwritten during structure generation.`); }

    let sourceFiles; let sourceFilesFound = false;
    try {
        sourceFiles = await getSourceFiles(sourceDir);
        if (sourceFiles && sourceFiles.length > 0) { sourceFilesFound = true; }
        else { console.log("\nNo source JSON files found to process."); sourceFiles = []; }
    } catch (error) {
        if (error.message.includes("Source directory not found")) { console.error(`\n❌ Error: ${error.message}`); process.exit(1); }
        else { console.error(`\n❌ Initialization failed: ${error.message}`); throw error; }
    }

    let filesProcessedTotal = 0; const languagesFullyProcessed = [];
    console.log("Ensuring target directories exist...");
    let dirCreationSuccess = true;
    for (const targetLang of targetLangs) {
        const targetDir = path.join(absoluteBaseDir, targetLang);
        try { await fs.mkdir(targetDir, { recursive: true }); }
        catch (error) { console.error(`❌ Error creating directory ${targetDir}: ${error.message}`); dirCreationSuccess = false; }
    }

    if (dirCreationSuccess && sourceFilesFound) {
        console.log("Processing target language files...");
        for (const targetLang of targetLangs) {
            const targetDir = path.join(absoluteBaseDir, targetLang);
            try {
                const success = await processLanguage(targetLang, targetDir, sourceDir, sourceFiles, enableTranslation, sourceLang);
                if (success) { languagesFullyProcessed.push(targetLang); filesProcessedTotal += sourceFiles.length; }
            } catch (error) { console.error(`\n❌ Unexpected error generating structure for language ${targetLang}: ${error.message}`); }
        }
    } else if (!dirCreationSuccess) { console.error("❌ Cannot proceed with file processing due to directory creation errors."); }

    console.log(`\n🎉 File structure ${mode} complete.`);
    if (filesProcessedTotal > 0) { console.log(`  Processed structure for ${filesProcessedTotal} files across ${languagesFullyProcessed.length} successfully processed languages.`); }
    else if (!sourceFilesFound) { console.log(`  Source directory checked. No source files found to process.`); console.log(`  Target directories ensured/checked for ${targetLangs.length} languages.`); }
    else { console.log(`  Target directories ensured/checked for ${targetLangs.length} languages.`); }

    if (languagesFullyProcessed.length > 0 && sourceFilesFound) {
        console.log("\n✨ Manual Action Required ✨");
        console.log("   Remember to manually update your main i18n configuration file (e.g., i18n.js/ts)");
        console.log("   to import the newly created/updated files and add them to your resources object.");
    }
}

/**
 * Main execution function
 */
async function main() {
    console.time('Total Execution Time'); // Start timer

    const args = process.argv.slice(2);
    const isSyncCommand = args.includes('sync');
    const commandName = isSyncCommand ? 'Synchronization' : 'Generation';

    console.log(`🚀 Starting i18n Structure ${commandName}...`);

    // 1. Load configuration from file first
    const loadedConfig = await loadConfig();

    // 2. Get final configuration, using loadedConfig and prompting for missing values
    const config = await getConfiguration(loadedConfig);

    // 3. Initialize Translator if enabled and API key is available
    let translationInitialized = false;
    if (config.translation?.enable && config.apiKey) {
        try {
            initializeTranslator(config.apiKey, config.translation.modelName); // Pass model name from config if available
            translationInitialized = true;
            console.log("✅ Translator initialized successfully.");
        } catch (initError) {
            console.error(`\n❌ ${initError.message}`);
            console.warn("   Translation will be disabled due to initialization error.");
            translationInitialized = false;
        }
    } else if (config.translation?.enable && !config.apiKey) {
        console.warn("   Translation enabled but API Key was not found or provided. Translation disabled.");
        translationInitialized = false;
    } else {
        console.log("ℹ️ Translation disabled.");
    }

    // 4. Execute Command
    if (isSyncCommand) {
        const absoluteBaseDir = path.resolve(process.cwd(), config.baseDir);
        // Pass only necessary info to runSync
        await runSync(
            absoluteBaseDir,
            config.sourceLang,
            config.targetLangsString, // The array of languages
            translationInitialized
            // No need for config file update params anymore
        );
    } else {
        // Pass necessary info to runGenerate
        await runGenerate(
            config, // Pass the whole config object containing paths/langs
            translationInitialized
            // No need for config file update params anymore
        );
    }

    console.log("\n✅ Script finished.");

    // --- Log Summary ---
    console.log("--- Execution Summary ---");
    console.timeEnd('Total Execution Time'); // Log total time
    if (config.translation?.enable) { // Base decision on initial intent
        const apiCalls = getApiCallCount();
        console.log(`   Google AI API Calls Made: ${apiCalls} (Translation was ${translationInitialized ? 'enabled' : 'disabled due to error'})`);
    } else {
        console.log("   Google AI API Calls Made: 0 (Translation was disabled)");
    }
    console.log("-------------------------");
}


// --- Script Entry Point ---
main().catch(error => {
    console.error("\n❌ An unexpected critical error occurred:", error.message);
    console.error(error.stack);
    console.timeEnd('Total Execution Time'); // Attempt to end timer on error
    process.exit(1);
});