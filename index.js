#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import inquirer from 'inquirer';
import { getBaseInputs } from './prompts.js';
import { getSourceFiles, processLanguage } from './fileOperations.js';
import { runSync } from './syncOperations.js';
import { normalizeImportPath, generateImportName } from './utils.js';
import { initializeTranslator } from './translator.js';


async function runGenerate(config, enableTranslation) {
    const { baseDir, sourceLang, targetLangsString: targetLangs } = config;
    const absoluteBaseDir = path.resolve(process.cwd(), baseDir);
    const sourceDir = path.join(absoluteBaseDir, sourceLang);

    const mode = enableTranslation ? 'Translation (Whole JSON Mode)' : 'Generation';
    console.log(`\nRunning Structure ${mode}`);
    console.log(`Source directory: ${sourceDir} (using language code: ${sourceLang})`);
    console.log(`Target languages: ${targetLangs.join(', ')}`);

    if (targetLangs.includes(sourceLang)) {
        console.warn(`\n⚠️ Warning: Source language '${sourceLang}' is also listed as a target language.`);
        console.warn(`   Files in '${sourceDir}' may be overwritten during structure generation.`);
    }

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
        }
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

    if (languagesFullyProcessed.length > 0 && sourceFilesFound) {
        console.log("\n✨ Manual Action Required ✨");
        console.log("   Remember to manually update your main i18n configuration file (e.g., i18n.js/ts)");
        console.log("   to import the newly created/updated files and add them to your resources object.");
        console.log("   Example for added languages/files:");
        languagesFullyProcessed.forEach(lang => {
            console.log(`     - Language: ${lang}`);
            if (sourceFiles.length > 0) {
                const exampleFile = sourceFiles[0];
                const exampleTargetFilePath = path.join(baseDir, lang, exampleFile);
                const exampleRelativePath = normalizeImportPath(`./${exampleTargetFilePath}`);
                const importName = generateImportName(lang, exampleFile);
                const resourceKey = path.basename(exampleFile, '.json');
                console.log(`       import ${importName} from '${exampleRelativePath}';`);
                console.log(`       ... add to resources: ${lang}: { ${resourceKey}: ${importName}, ... } ...`);
            }
        });
    }
}


async function main() {
    const args = process.argv.slice(2);
    const isSyncCommand = args.includes('sync');
    const commandName = isSyncCommand ? 'Synchronization' : 'Generation';

    console.log(`🚀 Starting i18n Structure ${commandName}...`);

    const baseConfig = await getBaseInputs();

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

    if (isSyncCommand) {
        const absoluteBaseDir = path.resolve(process.cwd(), baseConfig.baseDir);
        await runSync(
            absoluteBaseDir,
            baseConfig.sourceLang,
            baseConfig.targetLangsString,
            translationInitialized
        );
    } else {
        await runGenerate(
            baseConfig,
            translationInitialized
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