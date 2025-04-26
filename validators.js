// validators.js
// NOTE: fs and path are no longer needed here unless added back for other validations
// import fs from 'fs/promises';
// import path from 'path';
import iso6391 from 'iso-639-1';

/**
 * Validates the source language code input.
 * @param {string} input - User input.
 * @returns {string|boolean} - Error message string or true if valid.
 */
export function validateSourceLang(input) {
    const code = input.trim().toLowerCase(); // Standardize to lowercase
    if (!code) return 'Source language cannot be empty.';
    if (!iso6391.validate(code)) {
        const langName = iso6391.getName(code); // Check if it's known by another code type
        if (langName) {
            return `'${input}' seems valid but might not be the ISO 639-1 code. Consider using the official 2-letter code if available. (Known as: ${langName})`;
        }
        return `'${input}' is not a recognized ISO 639-1 language code.`;
    }
    return true;
}

/**
 * Validates the target language codes input.
 * @param {string} input - User input (comma-separated).
 * @returns {string|boolean} - Error message string or true if valid.
 */
export function validateTargetLangs(input) {
    const codes = input.split(',')
        .map(lang => lang.trim().toLowerCase()) // Standardize
        .filter(Boolean); // Remove empty strings

    if (codes.length === 0) return 'Target languages cannot be empty.';

    const invalidCodes = codes.filter(code => !iso6391.validate(code));

    if (invalidCodes.length > 0) {
        // Check if they are known by other names/codes
        const suggestions = invalidCodes.map(code => {
            const name = iso6391.getName(code);
            return name ? `${code} (Maybe use 2-letter code? Known as: ${name})` : code;
        }).join(', ');
        return `Invalid ISO 639-1 codes found: ${suggestions}. Please use 2-letter codes where possible.`;
    }
    return true;
}

// validateConfigFile function removed