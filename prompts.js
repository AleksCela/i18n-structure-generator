// prompts.js
import inquirer from 'inquirer';
import { validateSourceLang, validateTargetLangs } from './validators.js';

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
            validate: validateSourceLang,
            filter: input => input.trim().toLowerCase(),
        },
        {
            type: 'input',
            name: 'targetLangsString',
            message: 'Enter target language codes (ISO 639-1), comma-separated (e.g., fr, es, sq):',
            validate: validateTargetLangs,
            filter: input => input.split(',').map(lang => lang.trim().toLowerCase()).filter(Boolean),
        },
    ]);
}
