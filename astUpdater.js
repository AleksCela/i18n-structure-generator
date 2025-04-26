// astUpdater.js
import fs from 'fs/promises';
import path from 'path';
import parser from '@babel/parser';
import traverse from '@babel/traverse';
import generator from '@babel/generator';
import * as t from '@babel/types'; // Import babel types for creating AST nodes
import { generateImportName, normalizeImportPath } from './utils.js'; // Ensure utils are correctly imported

/**
 * Updates the i18n configuration file with new languages, imports, and resources.
 * Used primarily during the 'generate' command.
 *
 * @param {string} absoluteConfigFile - Absolute path to the config file.
 * @param {string} absoluteBaseDir - Absolute path to the base translation directory.
 * @param {string[]} languagesToAdd - Array of language codes to add.
 * @param {string[]} sourceFiles - Array of source JSON filenames (used to generate imports/keys).
 * @returns {Promise<void>}
 * @throws {Error} If any step in the update process fails critically.
 */
export async function updateI18nConfigFile(absoluteConfigFile, absoluteBaseDir, languagesToAdd, sourceFiles) {
    console.log(`\n🔧 Attempting to update configuration file: ${absoluteConfigFile}`);
    const configDir = path.dirname(absoluteConfigFile);
    let configFileContent; // To store original content for generator

    try {
        // Read the original content first
        configFileContent = await fs.readFile(absoluteConfigFile, 'utf-8');

        // Parse the code into an Abstract Syntax Tree (AST)
        let ast;
        try {
            ast = parser.parse(configFileContent, {
                sourceType: 'module', // Specify source type as ES Module
                plugins: ['jsx'] // Enable JSX syntax parsing if potentially used
            });
        } catch (parseError) {
            // If parsing fails, throw a user-friendly error
            throw new Error(`Failed to parse config file '${path.basename(absoluteConfigFile)}'. Check for syntax errors. \n   ${parseError.message}`);
        }

        // --- Prepare AST Nodes for New Entries ---
        let lastImportDeclarationPath = null; // To find where to insert new imports
        let resourcesVarPath = null; // Path to the 'resources' object literal {}
        const newImports = []; // Array to hold new import declaration nodes
        const newResourceProps = {}; // Object to hold new resource properties { lang: [propNodes] }

        // Generate the necessary import and resource property nodes for each new language and file
        for (const lang of languagesToAdd) {
            newResourceProps[lang] = []; // Initialize array for this language's properties
            for (const filename of sourceFiles) {
                // Create a conventional variable name (e.g., frHero)
                const importName = generateImportName(lang, filename);
                // Get the full path to the target JSON file
                const targetFilePath = path.join(absoluteBaseDir, lang, filename);
                // Calculate the relative path from the config file's directory
                let relativePath = path.relative(configDir, targetFilePath);
                // Ensure the relative path starts correctly for import statements
                if (!relativePath.startsWith('.')) {
                    relativePath = './' + relativePath;
                }
                // Use forward slashes for import paths
                relativePath = normalizeImportPath(relativePath);

                // Create the AST node for the import declaration
                // e.g., import frHero from './translations/fr/hero.json';
                const importNode = t.importDeclaration(
                    [t.importDefaultSpecifier(t.identifier(importName))], // Assuming default export from JSON
                    t.stringLiteral(relativePath)
                );
                newImports.push(importNode);

                // Prepare the property node for the resources object
                // e.g., hero: frHero
                const resourceKey = path.basename(filename, '.json');
                newResourceProps[lang].push(
                    t.objectProperty(
                        // Use identifier for key if valid, otherwise string literal
                        t.isValidIdentifier(resourceKey) ? t.identifier(resourceKey) : t.stringLiteral(resourceKey),
                        t.identifier(importName), // The value is the imported variable name
                        false, // computed: false
                        // Shorthand (e.g., { hero } instead of { hero: hero }) - check if key matches var name
                        resourceKey === importName.substring(lang.length).toLowerCase()
                    )
                );
            }
        }

        // --- Traverse AST to find insertion points ---
        // Use babel traverse to walk through the AST nodes
        traverse.default(ast, {
            // Find the last import declaration node
            ImportDeclaration(path) {
                lastImportDeclarationPath = path; // Keep updating to find the last one
            },
            // Find the variable declaration for 'resources'
            VariableDeclarator(path) {
                // Check if the variable name is 'resources'
                if (path.node.id.type === 'Identifier' && path.node.id.name === 'resources') {
                    // Check if it's initialized with an ObjectExpression (e.g., = {})
                    if (t.isObjectExpression(path.node.init)) {
                        resourcesVarPath = path.get('init'); // Get the Babel path object for the object node {}
                    } else {
                        // Warn if 'resources' is found but isn't an object literal
                        console.warn(`Found 'resources' variable but it's not initialized with an Object literal (e.g., {}). Cannot automatically update.`);
                    }
                }
            }
        });

        // If the resources object wasn't found, we can't proceed
        if (!resourcesVarPath) {
            throw new Error("Could not find the 'resources = {}' variable declaration. Automatic update failed.");
        }

        // --- Modify AST: Add new languages and properties ---
        let addedLangsCount = 0;
        languagesToAdd.forEach(lang => {
            // Check if a property for this language already exists in the resources object
            const langExists = resourcesVarPath.node.properties.some(prop => {
                const key = prop.key;
                // Check if key is an Identifier (name) or StringLiteral (value) matching the lang code
                return (t.isIdentifier(key) && key.name === lang) || (t.isStringLiteral(key) && key.value === lang);
            });

            // If the language property doesn't exist, add it
            if (!langExists) {
                console.log(`    Adding language '${lang}' to resources object...`);
                // Create the new property for the language (e.g., fr: { hero: frHero, ... })
                const langProperty = t.objectProperty(
                    t.identifier(lang), // Key is the language code identifier
                    t.objectExpression(newResourceProps[lang]) // Value is an object with file keys/import vars
                );
                // Add the new language property to the main resources object's properties array
                resourcesVarPath.pushContainer('properties', langProperty);
                addedLangsCount++;
            } else {
                // Warn if the language already exists (we don't overwrite/merge in this simple version)
                console.warn(`    ⚠️ Language '${lang}' already exists in the resources object. Skipping update for this language.`);
            }
        });

        // --- Modify AST: Insert new import declarations ---
        // Only add imports if we actually added corresponding languages to the resources
        if (newImports.length > 0 && addedLangsCount > 0) {
            if (lastImportDeclarationPath) {
                // Insert imports one by one in reverse order after the last existing import
                // Reversing ensures they appear in the original file order relative to each other
                lastImportDeclarationPath.insertAfter(newImports.reverse());
            } else {
                // If no imports exist, add them at the very beginning of the program body
                ast.program.body.unshift(...newImports.reverse());
            }
            console.log(`    Added ${newImports.length} import statements.`);
        } else if (newImports.length > 0 && addedLangsCount === 0) {
            console.log(`    Skipping import statement additions as no new languages were added to the resources object.`);
        }

        // --- Generate Code and Write Back ---
        // Only generate & write if actual changes were made to the resources object structure
        if (addedLangsCount > 0) {
            // Generate JavaScript code string from the modified AST
            // Use default generator options; disable comments to avoid potential merging issues
            const output = generator.default(ast, { /* options */ comments: false }, configFileContent);
            const updatedCode = output.code;

            // Optional: Backup original file before overwriting
            // await fs.copyFile(absoluteConfigFile, absoluteConfigFile + '.bak');
            // console.log(`    Created backup: ${path.basename(absoluteConfigFile)}.bak`);

            // Write the updated code back to the config file
            await fs.writeFile(absoluteConfigFile, updatedCode, 'utf-8');
            console.log(`    ✅ Successfully updated ${path.basename(absoluteConfigFile)}`);
        } else {
            console.log(`    No new languages were added to the resources object. Config file not modified.`);
        }

    } catch (error) {
        // Catch errors from file reading, parsing, traversal, generation, writing
        console.error(`\n❌ Error during configuration file update: ${error.message}`);
        // Re-throw the error to be caught by the main error handler in index.js
        throw error;
    }
}


/**
 * Removes an entry (import and resource key) for a specific language/file
 * from the i18n configuration file. Used primarily during the 'sync' command
 * when files are deleted.
 *
 * @param {string} absoluteConfigFile - Absolute path to the config file.
 * @param {string} langToRemove - The language code (e.g., 'fr').
 * @param {string} fileToRemove - The base filename (e.g., 'hero.json').
 * @param {string} configDir - Absolute directory path of the config file.
 * @param {string} absoluteBaseDir - Absolute path to the base translation directory.
 * @returns {Promise<boolean>} - True if changes were made, false otherwise.
 */
export async function removeEntryFromI18nConfig(absoluteConfigFile, langToRemove, fileToRemove, configDir, absoluteBaseDir) {
    console.log(`    🔧 Attempting to remove entry for ${langToRemove}/${fileToRemove} from config...`);
    let changesMade = false;
    let configFileContent;

    try {
        // Read current content
        configFileContent = await fs.readFile(absoluteConfigFile, 'utf-8');
        let ast;
        try {
            // Parse AST
            ast = parser.parse(configFileContent, { sourceType: 'module', plugins: ['jsx'] });
        } catch (parseError) {
            console.error(`    ❌ Failed to parse config file. Cannot remove entry. ${parseError.message}`);
            return false; // Don't proceed if parsing fails
        }

        // Determine the names/paths we need to find and remove
        const importName = generateImportName(langToRemove, fileToRemove);
        const resourceKey = path.basename(fileToRemove, '.json');
        // Calculate the expected import path relative to the config file
        const targetFilePath = path.join(absoluteBaseDir, langToRemove, fileToRemove);
        let relativePath = path.relative(configDir, targetFilePath);
        if (!relativePath.startsWith('.')) { relativePath = './' + relativePath; }
        const expectedImportPath = normalizeImportPath(relativePath);

        let importRemoved = false;
        let resourceRemoved = false;
        let languageResourceIsEmpty = false; // Flag to check if lang object becomes empty
        let resourcesVarPath = null; // Path to the main resources = {}
        let langPropertyPath = null; // Path to the specific language object value, e.g., the {} in fr: {}

        // Traverse the AST to find and remove nodes
        traverse.default(ast, {
            // Find and remove the specific import declaration
            ImportDeclaration(path) {
                // Check if the import source path matches
                if (path.node.source.value === expectedImportPath) {
                    // Find the default specifier (e.g., 'frHero' in 'import frHero from ...')
                    const defaultSpecifier = path.node.specifiers.find(s => t.isImportDefaultSpecifier(s));
                    // Check if the imported variable name matches the one we want to remove
                    if (defaultSpecifier && defaultSpecifier.local.name === importName) {
                        console.log(`      ➖ Removing import: import ${importName} from '${expectedImportPath}'`);
                        path.remove(); // Remove the entire import declaration node
                        importRemoved = true;
                        changesMade = true;
                        path.stop(); // Stop traversal for imports once found and removed
                    }
                }
                // Note: This assumes one default import per line. Logic might need adjustment
                // if multiple variables are imported from the same file on one line.
            },

            // Find the resources object and the specific key to remove
            VariableDeclarator(path) {
                // Find 'resources = {}'
                if (path.node.id.type === 'Identifier' && path.node.id.name === 'resources') {
                    if (t.isObjectExpression(path.node.init)) {
                        resourcesVarPath = path.get('init'); // Get path to the main {}

                        // Find the property for the language (e.g., 'fr') within resources {}
                        const langPropPath = resourcesVarPath.get('properties').find(propPath => {
                            const propNode = propPath.node;
                            return t.isObjectProperty(propNode) &&
                                ((t.isIdentifier(propNode.key) && propNode.key.name === langToRemove) ||
                                    (t.isStringLiteral(propNode.key) && propNode.key.value === langToRemove)) &&
                                t.isObjectExpression(propNode.value); // Ensure value is {}
                        });


                        if (langPropPath) {
                            // Get the path to the language's value object (the {} in fr: {})
                            langPropertyPath = langPropPath.get('value');

                            // Iterate through properties within the language object (e.g., properties of fr: {})
                            langPropertyPath.get('properties').forEach(propPath => {
                                const keyNode = propPath.node.key;
                                // Check if the property key matches the resource key to remove
                                if ((t.isIdentifier(keyNode) && keyNode.name === resourceKey) ||
                                    (t.isStringLiteral(keyNode) && keyNode.value === resourceKey)) {
                                    console.log(`      ➖ Removing resource key: ${langToRemove}.${resourceKey}`);
                                    propPath.remove(); // Remove the property (e.g., hero: frHero)
                                    resourceRemoved = true;
                                    changesMade = true;

                                    // Check if this removal made the language object empty
                                    if (langPropertyPath.node.properties.length === 0) {
                                        languageResourceIsEmpty = true;
                                    }
                                    // We assume only one key matches, could add path.stop() here if needed
                                }
                            });
                        }
                    }
                }
            } // End VariableDeclarator visitor
        }); // End traverse

        // After traversal, check if the language object needs to be removed because it's empty
        if (languageResourceIsEmpty && langPropertyPath) {
            const parentObjectPropertyPath = langPropertyPath.parentPath; // Path to the 'fr: {}' ObjectProperty
            if (parentObjectPropertyPath && parentObjectPropertyPath.isObjectProperty()) {
                console.log(`      ➖ Removing empty language entry: ${langToRemove}`);
                parentObjectPropertyPath.remove(); // Remove the 'fr: {}' node itself
                // changesMade is already true if we removed the last key
            }
        }

        // Log if the entry wasn't found (and therefore no changes made)
        if (!importRemoved && !resourceRemoved) {
            console.log(`      ℹ️ Entry for ${langToRemove}/${fileToRemove} not found in config file. No changes needed.`);
            return false;
        }

        // Generate code and write back ONLY if changes were made
        if (changesMade) {
            const output = generator.default(ast, { comments: false }, configFileContent);
            await fs.writeFile(absoluteConfigFile, output.code, 'utf-8');
            console.log(`      ✅ Config file updated.`);
            return true; // Indicate changes were written
        } else {
            return false; // No changes were ultimately made or needed
        }

    } catch (error) {
        // Catch errors from file read, parse, traverse, generate, write
        console.error(`    ❌ Error removing entry for ${langToRemove}/${fileToRemove} from config: ${error.message}`);
        // Don't re-throw, allow sync process to continue with other files/languages
        return false; // Indicate failure or no changes due to error
    }
}