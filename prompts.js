// prompts.js
import inquirer from 'inquirer';
// Import needs to be dynamic for ESM in some Node versions if validators isn't explicitly listed in package.json imports, but direct static should work with type:module
import { validateSourceLang, validateTargetLangs, validateConfigFile } from './validators.js';

/**
 * Gathers user input for base directory and languages.
 * @returns {Promise<object>} A promise that resolves with the user's answers.
 */
export async function getBaseInputs() {
    return await inquirer.prompt([
        {
            type: 'input',
            name: 'baseDir',
            message: 'Enter the base directory containing language folders (e.g., ./translations):',
            default: './translations',
        },
        {
            type: 'input',
            name: 'sourceLang',
            message: 'Enter the source language code (ISO 639-1, e.g., en, sq):',
            validate: validateSourceLang, // Use imported validator
            filter: input => input.trim().toLowerCase(),
        },
        {
            type: 'input',
            name: 'targetLangsString', // Keep name consistent with index.js usage
            message: 'Enter target language codes (ISO 639-1), comma-separated (e.g., fr, es, sq):',
            validate: validateTargetLangs, // Use imported validator
            // Filter transforms the comma-separated string into an array of codes
            filter: input => input.split(',').map(lang => lang.trim().toLowerCase()).filter(Boolean),
        },
    ]);
}


/**
 * Asks the user if they want to attempt automatic config file updates.
 * @returns {Promise<boolean>} True if the user wants to attempt updates.
 */
export async function askAttemptAutoUpdate() {
    const { attemptAutoUpdate } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'attemptAutoUpdate',
            message: 'Do you want this script to attempt automatic i18n config file updates (imports/resources)?',
            default: false, // Default to No for safety
        }
    ]);
    return attemptAutoUpdate;
}

/**
 * Prompts the user for the i18n configuration file path.
 * @returns {Promise<string>} The relative config file path entered by the user.
 */
export async function getConfigFileInput() {
    const { configFile } = await inquirer.prompt([
        {
            type: 'input',
            name: 'configFile',
            message: 'Enter the path to your main i18n configuration file (e.g., ./src/i18n.js):',
            validate: validateConfigFile, // Use imported validator
            filter: input => input.trim(),
        }
    ]);
    return configFile;
}


/**
 * Asks the user for confirmation before actually updating the config file (generate command).
 * @param {string} configFile - The relative path to the config file.
 * @param {string[]} languages - The list of languages to be added.
 * @returns {Promise<boolean>} - True if the user confirms, false otherwise.
 */
export async function confirmConfigFileUpdate(configFile, languages) {
    // Only ask if there are languages to add
    if (!languages || languages.length === 0) {
        console.log("No fully processed languages eligible for config update.");
        return false;
    }
    const { confirmUpdate } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirmUpdate',
            message: `Confirm: Update '${configFile}' to include resources for ${languages.length} language(s) (${languages.join(', ')})?`,
            default: true,
        }
    ]);
    return confirmUpdate;
}