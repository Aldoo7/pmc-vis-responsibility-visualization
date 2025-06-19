const vscode = require('vscode');

//Initialize Token Legend
const tokenTypes = new Map();
const tokenModifiers = new Map();
const tokenLegend = (function () {
    const tokenTypesLegend = ['parameter', 'variable', 'function'];
    tokenTypesLegend.forEach((tokenType, index) => tokenTypes.set(tokenType, index));
    const tokenModifiersLegend = ['readonly', 'modification'];
    tokenModifiersLegend.forEach((tokenModifier, index) => tokenModifiers.set(tokenModifier, index));
    return new vscode.SemanticTokensLegend(tokenTypesLegend, tokenModifiersLegend);
})();

//Global Storage for pattern matching for declarations
let _constants = null;
let _formulas = null;
let _variables = null;

//RegExps
const constantRegExp = /^\s*const\s+(int|bool)\s+(\w+)\s*=\s*(.+?)\s*;$/
const formulaRegExp = /^\s*formula\s+(\w+)\s*=\s*(.+?)\s*;$/
const variableRegExp = /^(?:\s*global)?\s*(\w+)\s*:\s*(?:(?:\[\s*(\w+)\s*\.\.\s*(\w+)\s*\])|(?:bool))(?:\s*init\s+(?:\w+))?\s*;$/
const renameRegExp = /(\w+)\s*=\s*(\w+)/

class DocumentSemanticTokensProvider {
    async provideDocumentSemanticTokens(document) {
        //Gather Declerations from the entire document
        this._initializeDocument(document);

        //Gather tokens over the entire document
        const tokens = this._parseText(document.getText());

        //Build actual tokens
        const builder = new vscode.SemanticTokensBuilder();
        tokens.forEach((token) => {
            builder.push(token.line, token.startCharacter, token.length, this._encodeTokenType(token.tokenType), this._encodeTokenModifiers(token.tokenModifiers));
        });
        return builder.build();
    }

    _parseConstants(text) {
        const lines = text.split(/\r\n|\r|\n/);
        let constants = [];

        //gather all declerations
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const matched_c = line.match(constantRegExp)
            if (matched_c != null) {
                constants.push(matched_c[2]);
            }
        }
        return constants;
    }

    _parseFormulas(text) {
        const lines = text.split(/\r\n|\r|\n/);

        let formulas = [];

        //gather all declerations
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const matched_f = line.match(formulaRegExp)
            if (matched_f != null) {
                formulas.push(matched_f[1]);
            }
        }
        return formulas;
    }

    _parseVariables(text) {
        const lines = text.split(/\r\n|\r|\n/);

        let variables = [];

        //gather all declerations
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const matched_v = line.match(variableRegExp)
            if (matched_v != null) {
                variables.push(matched_v[1]);
            }
        }
        return variables;
    }

    _parseRenameBlock(text) {

        const match = text.match(/module\s+\w+\s*=\s*\w+\s*\[([^\]]*?)\]/);

        if (match == null) {
            return []
        }

        const interior = match[1].replace(/(\r\n|\n|\r)/gm, "").trim()
        const rest = text.replace(match[0], "")
        let blocks = [interior].concat(this._parseRenameBlock(rest));
        return blocks;
    }

    _parseRenamings(text, constants, formulas, variables) {
        const renameArea = this._parseRenameBlock(text)

        //gather all declerations
        for (let i = 0; i < renameArea.length; i++) {
            const fields = renameArea[i].split(/,/);
            for (let j = 0; j < fields.length; j++) {
                const field = fields[j];
                const matched_r = field.match(renameRegExp)
                if (matched_r != null) {
                    const existingField = matched_r[1]
                    const newField = matched_r[2]
                    if (variables.includes(existingField)) {
                        variables.push(newField);
                        continue;
                    }
                    if (formulas.includes(existingField)) {
                        formulas.push(newField);
                        continue;
                    }
                    if (constants.includes(existingField)) {
                        constants.push(newField);
                        continue;
                    }
                }
            }
        }
        return [constants, formulas, variables];
    }

    _encodeTokenType(tokenType) {
        if (tokenTypes.has(tokenType)) {
            return tokenTypes.get(tokenType);
        }
        else if (tokenType === 'notInLegend') {
            return tokenTypes.size + 2;
        }
        return 0;
    }

    _encodeTokenModifiers(strTokenModifiers) {
        let result = 0;
        for (let i = 0; i < strTokenModifiers.length; i++) {
            const tokenModifier = strTokenModifiers[i];
            if (tokenModifiers.has(tokenModifier)) {
                result = result | (1 << tokenModifiers.get(tokenModifier));
            }
            else if (tokenModifier === 'notInLegend') {
                result = result | (1 << tokenModifiers.size + 2);
            }
        }
        return result;
    }

    _initializeDocument(document) {

        const text = document.getText();

        //Read all constant declarations and save them globally
        const init_constants = this._parseConstants(text);
        const init_formulas = this._parseFormulas(text);
        const init_variables = this._parseVariables(text);

        const [constants, formulas, variables] = this._parseRenamings(text, init_constants, init_formulas, init_variables)

        if (constants.length > 0) {
            _constants = new RegExp(`\\b(${constants.join("|")})\\b`, 'g');
        } else {
            _constants = new RegExp("^\b$", ''); // This does not match anything
        }

        //Read all function declarations and save them globally

        if (formulas.length > 0) {
            _formulas = new RegExp(`\\b(${formulas.join("|")})\\b`, 'g');
        } else {
            _formulas = new RegExp("^\b$", ''); // This does not match anything
        }

        //Read all variable declarations and save them globally

        if (variables.length > 0) {
            _variables = new RegExp(`\\b(${variables.join("|")})\\b`, 'g');
        } else {
            _variables = new RegExp("^\b$", ''); // This does not match anything
        }
    }

    _parseText(text) {
        const token = [];
        const lines = text.split(/\r\n|\r|\n/);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let match;

            //Check for constants
            while ((match = _constants.exec(line)) !== null) {
                token.push({
                    line: i,
                    startCharacter: match.index,
                    length: match[0].length,
                    tokenType: 'parameter',
                    tokenModifiers: 'readonly'
                });
            }
            //Check for Formulas
            while ((match = _formulas.exec(line)) !== null) {
                token.push({
                    line: i,
                    startCharacter: match.index,
                    length: match[0].length,
                    tokenType: 'function',
                    tokenModifiers: 'readonly'
                });
            }

            //Check for Variables
            while ((match = _variables.exec(line)) !== null) {
                token.push({
                    line: i,
                    startCharacter: match.index,
                    length: match[0].length,
                    tokenType: 'variable',
                    tokenModifiers: 'readonly'
                });
            }
        }
        return token;
    }
}

module.exports = { DocumentSemanticTokensProvider, tokenLegend };

