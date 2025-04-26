// validators.js
import fs from 'fs/promises';
import path from 'path';
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

/**
 * Validates the config file path input. Checks existence and read access.
 * @param {string} input - User input path.
 * @returns {Promise<string|boolean>} - Error message string or true if valid.
 */
export async function validateConfigFile(input) {
    const trimmedInput = input.trim();
    if (!trimmedInput) return 'Config file path cannot be empty.';
    try {
        const configPath = path.resolve(process.cwd(), trimmedInput);
        // Check if path exists and we have read access
        await fs.access(configPath, fs.constants.R_OK);
        // Check if it's a file, not a directory
        const stats = await fs.stat(configPath);
        if (!stats.isFile()) {
            return `Path exists but is not a file: ${trimmedInput}`;
        }
        return true; // Path is valid, readable, and a file
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File not found
            return `Cannot find file: ${trimmedInput}. Please check the path.`;
        } else if (error.code === 'EACCES') {
            // Permission denied
            return `Permission denied to read file: ${trimmedInput}.`;
        }
        // Log unexpected errors for debugging, but show generic message
        console.error("Unexpected config file validation error:", error);
        return `Cannot access file: ${trimmedInput}. Please check the path and permissions.`;
    }
}