const vscode = require('vscode');
const mathjs = require('mathjs');

//Color used in Decorations
const green = "#b3ffb3";
const red = "#ff9999";
const yellow = "#ffff99";
const grey = "#f2f2f2";

//RegExpressions used
const constantRegExp = /^\s*const\s+(int|bool)\s+(\w+)\s*=\s*(.+?)\s*;$/
const formulaRegExp = /^\s*formula\s+(\w+)\s*=\s*(.+?)\s*;$/
const variableDefRegExp = /^\s*(\w+)\s*:\s*(?:\[\s*(\w+)\s*\.\.\s*(\w+)\s*\]|bool)(\s*init\s+(\w+))?\s*;$/
const variableRegExp = /^\s*(\w+)\s*:\s*(?:\[\s*(\w+)\s*\.\.\s*(\w+)\s*\]|bool)(\s*init\s+(\w+))?\s*;$/gm
const actionRegExp = /\[(.*)\]\s*(.*)\s*->(.*?);/gm
const moduleRegExp = /module (.*?)$(.*?)endmodule/gms

const allowedActionDecoration = vscode.window.createTextEditorDecorationType({
    borderWidth: '1px',
    borderStyle: 'solid',
    overviewRulerColor: green,
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    light: {
        // this color will be used in light color themes
        borderColor: green,
        backgroundColor: green
    },
    dark: {
        // this color will be used in dark color themes
        borderColor: green,
        backgroundColor: green
    }
});

//Decoration signifying that corresponding action can not proceed locally
const blockedActionDecoration = vscode.window.createTextEditorDecorationType({
    borderWidth: '1px',
    borderStyle: 'solid',
    overviewRulerColor: red,
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    light: {
        // this color will be used in light color themes
        borderColor: red,
        backgroundColor: red
    },
    dark: {
        // this color will be used in dark color themes
        borderColor: red,
        backgroundColor: red
    }
});

//Decoration signifying that corresponding action can proceed locally, but not globally #TODO(implemented)
const partiallyBlockedActionDecoration = vscode.window.createTextEditorDecorationType({
    borderWidth: '1px',
    borderStyle: 'solid',
    overviewRulerColor: yellow,
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    light: {
        // this color will be used in light color themes
        borderColor: yellow,
        backgroundColor: yellow
    },
    dark: {
        // this color will be used in dark color themes
        borderColor: yellow,
        backgroundColor: yellow
    }
});

const varDecoration = vscode.window.createTextEditorDecorationType({
    borderWidth: '1px',
    borderStyle: 'solid',
    light: {
        // this color will be used in light color themes
        borderColor: grey,
        backgroundColor: grey
    },
    dark: {
        // this color will be used in dark color themes
        borderColor: grey,
        backgroundColor: grey
    }
});

class Decorator{
    constructor(text){
        this._constantDef = new Map();
        this._formulaDef = new Map();
        this._variableDef = new Map();

        this._constantLoc = new Map();
        this._formulaLoc = new Map();
        this._variableLoc = new Map();

        this.parseConstants(text);
        this.parseFormulas(text);
        this.parseVariables(text);
    }

    matchVars(state){
        for(let key in state.variables){
            if(!this._variableDef.has(key)){
                return false;
            }
        }
        return true;
    }
    
    updateInfo(state, activeEditor) {
    
        if (!activeEditor | !state) {
            activeEditor.setDecorations(allowedActionDecoration, []);
            activeEditor.setDecorations(blockedActionDecoration, []);
            activeEditor.setDecorations(partiallyBlockedActionDecoration, []);
            activeEditor.setDecorations(varDecoration, []);
            return;
        }
    
        if(!this.matchVars(state)){
            activeEditor.setDecorations(allowedActionDecoration, []);
            activeEditor.setDecorations(blockedActionDecoration, []);
            activeEditor.setDecorations(partiallyBlockedActionDecoration, []);
            activeEditor.setDecorations(varDecoration, []);
            vscode.window.showInformationMessage(`States did not match up with document specification. Did you link the right project?`)
            return;
        }
    
        const document = activeEditor.document;
        const [modules, actions] = this.gatherInformation(document, state);
    
        const allowed = [];
        const blocked = [];
        const partBlocked = [];
        let match;
    
        //Match actions with their guards, and evaluate accepting and blocking actions
        while ((match = actionRegExp.exec(document.getText()))) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[1].length + 2);
    
            let module = modules[0];
            for(const m of modules){
                if(m.startPosition.isBefore(startPos) & m.startPosition.isAfter(module.startPosition)){
                    module = m;
                }
            }
    
            const action = module.actions.get(startPos.line);
            const actionName = match[1];
    
            const openLocal = action.enabled;
            const openGlobal = actions.get(actionName);
    
            const hovermessage = new vscode.MarkdownString(`Extended Guard:  \n  `, true);
            hovermessage.isTrusted = true;
            hovermessage.appendMarkdown(`${action.guard}`);
    
            if (openLocal) {
                if(openGlobal[0]){
                    const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: hovermessage};
                    allowed.push(decoration);
                }else{
                    const blockingModules = openGlobal[1].map(item => {
                        const module = modules[item];
                        return `[${module.name}](command:pmcVis.moveTo?${module.startPosition.line})`;
                    }).join(",");
                    hovermessage.appendMarkdown(`\n\nBlocked by the following modules:  \n  ${blockingModules}`);
                    const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: hovermessage };
                    partBlocked.push(decoration);
                }
            } else {
                
                const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: hovermessage};
                blocked.push(decoration);
            }
        }
        activeEditor.setDecorations(allowedActionDecoration, allowed);
        activeEditor.setDecorations(blockedActionDecoration, blocked);
        activeEditor.setDecorations(partiallyBlockedActionDecoration, partBlocked);
    
        const varDeco = [];
        for(let key in state.variables){
            const varReg = new RegExp(`\\b${key}\\b`, 'gm');
            while ((match = varReg.exec(document.getText()))) {
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                const hoverMessage = new vscode.MarkdownString();
                hoverMessage.appendMarkdown(`[${key}](command:pmcVis.moveTo?${this._variableLoc.get(key)}) = ${state.variables[key]}`);
                hoverMessage.isTrusted = true;
                const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: hoverMessage };
                varDeco.push(decoration);
            }
        }
        for(const [formulaReg, definition] of this._formulaDef){
            const formEval = this.evaluate(this.fillExpression(definition), state);
            while ((match = formulaReg.exec(document.getText()))) {
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                const hoverMessage = new vscode.MarkdownString();
                hoverMessage.appendMarkdown(`[${match[0]}](command:pmcVis.moveTo?${this._formulaLoc.get(match[0])})==${formEval}`);
                hoverMessage.appendMarkdown(`  \n  Expanded Formula: ${definition}`);
                hoverMessage.isTrusted = true;
                const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: hoverMessage};
                varDeco.push(decoration);
            }
        }
        for(const [constReg, definition] of this._constantDef){
            while ((match = constReg.exec(document.getText()))) {
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                const hoverMessage = new vscode.MarkdownString();
                hoverMessage.appendMarkdown(`[${match[0]}](command:pmcVis.moveTo?${this._constantLoc.get(match[0])})=${definition}`);
                hoverMessage.isTrusted = true;
                const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: hoverMessage};
                varDeco.push(decoration);
            }
        }
        activeEditor.setDecorations(varDecoration, varDeco);
    }
    
    //Gathers all ction guards in the document
    gatherInformation(document, state){
        const modules = [];
        const enabledActionsGlobal =new Map();
        let matchModule;
        let i = 0;
    
        //Gather Information About every Module
        while ((matchModule = moduleRegExp.exec(document.getText()))) {
            const mPos = document.positionAt(matchModule.index);
            const name = matchModule[1];
            const text = matchModule[2];
    
            const actions = new Map();
            const enabledActions = new Map();
            let match;
    
            while ((match = actionRegExp.exec(text))) {
                const startLine = document.positionAt(matchModule.index + name.length + 8 + match.index).line;
                const action = match[1];
                const guard = this.fillExpression(match[2]);
                const enabled = this.evaluate(guard, state);
    
                actions.set(startLine, {
                    name: action,
                    guard: guard,
                    enabled: enabled,
                })
    
                if(!enabledActions.has(action)){
                    enabledActions.set(action, enabled)
                }else{
                    const gEnabled = enabledActions.get(action);
                    enabledActions.set(action, enabled || gEnabled);
                }
            }
    
            const variables = new Map();
    
            while ((match = variableRegExp.exec(text))) {
                const varName = match[1];
                let minV;
                let maxV;
                if(match[2]){
                    minV = match[2];
                    maxV = match[3];
                }else{
                    minV = 0;
                    maxV = 1;
                }
                
    
                const current = state.variables[varName];
                
                variables.set(varName, {
                    name: varName,
                    minimum: minV,
                    maximum: maxV,
                    current: current
                });
            }
    
            modules.push({
                id: i,
                name: name,
                actions: actions,
                variables: variables,
                enabledActions: enabledActions,
                startPosition: mPos
            })
    
            //Combine module enabled Information in order to determine general availability
            for(const [action, enabled] of enabledActions){
                if (!enabledActionsGlobal.has(action)){
                    if(enabled){
                        enabledActionsGlobal.set(action, [true]);
                    }else{
                        enabledActionsGlobal.set(action, [false, [i]]);
                    }
                    
                }else{
                    const gEnabled = enabledActionsGlobal.get(action)[0];
                    if(!gEnabled && !enabled){
                        const prevCounter = enabledActionsGlobal.get(action)[1];
                        prevCounter.push(i);
                        enabledActionsGlobal.set(action, [false, prevCounter]);
                    }
                    if(gEnabled && !enabled){
                        enabledActionsGlobal.set(action, [false, [i]]);
                    }
                }
            }
            i = i+1;
        }
        return [modules, enabledActionsGlobal];
    }
    
    //Replace Expression with all Formulas Expanded and all constant values alredy filled in
    fillExpression(text){
        let t = false;
        let expression = text;
        while(!t){
            t = true;
            for (const [key, value] of this._formulaDef) {
                // eslint-disable-next-line no-unused-vars
                expression = expression.replaceAll(key, function(token){ t = false; return value; });
            }
        }
        for (const [key, value] of this._constantDef) {
            expression = expression.replaceAll(key, value);
        }
        return expression;
    }
    
    //Evaluate expanded expression
    evaluate(expression, state){
        const exp = this.clean(expression);
        const res = mathjs.evaluate(exp, state.variables)
        return res;
    }
    
    //Translate prism Syntax into mathjs syntax
    clean(expression){
        if(Array.isArray(expression)){
            const e = expression.map(k => this.clean(k));
            return e;
        }
        let e = expression.replaceAll("&", " and ");
        e = e.replaceAll("|", " or ");
        e = e.replaceAll(/(?<!!|<|>)=/g, "==");
        e = e.replaceAll(/!(?!=)/g, " not ");
        return e;
    }
    
    parseConstants(text){
        const lines = text.split(/\r\n|\r|\n/);
    
        //gather all declerations
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const matched_c = line.match(constantRegExp);
            if (matched_c != null){
                this._constantDef.set(new RegExp(`\\b${matched_c[2]}\\b`, 'g'), matched_c[3]);
                this._constantLoc.set(matched_c[2], i);
            }
        }
    }
    
    parseFormulas(text){
        const lines = text.split(/\r\n|\r|\n/);
        
        //gather all declerations
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const matched_f = line.match(formulaRegExp);
            if (matched_f != null){
                this._formulaDef.set(new RegExp(`\\b${matched_f[1]}\\b`, 'g'), matched_f[2]);
                this._formulaLoc.set(matched_f[1], i);
            }
        }
    }
    
    parseVariables(text){
        const lines = text.split(/\r\n|\r|\n/);
    
        //gather all declerations
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const matched_v = line.match(variableDefRegExp);
            if (matched_v != null){
                if(matched_v[2]){
                    this._variableDef.set(matched_v[1], [matched_v[2], matched_v[3]]);
                }else{
                    this._variableDef.set(matched_v[1], [0,1]);
                }
                
                this._variableLoc.set(matched_v[1], i);
            }
        }
    }
}



module.exports = {Decorator}