const vscode = require('vscode');
// @ts-ignore
const mathjs = require('mathjs');

//Color used in Decorations
// NOTE: User requested swap: green now indicates blocked, red indicates allowed
const green = "#b3ffb3"; // now: blocked action
const red = "#ff9999";   // now: allowed action
const yellow = "#ffff99"; // existing meaning: partially blocked action (local ok, global blocked)
const grey = "#f2f2f2";  // variable highlight border

// Responsibility heatmap colors (low -> high suspicion)
const respCool = "#e1f5fe";      // very low responsibility (exonerated)
const respLow = "#b3e5fc";
const respMid = "#81d4fa";
const respHigh = "#29b6f6";
const respHot = "#0288d1";      // high responsibility (suspicious)
const respMax = "#01579b";      // top responsibility (most suspicious)

//RegExpressions used
const constantRegExp = /^\s*const\s+(int|bool)\s+(\w+)\s*=\s*(.+?)\s*;$/
const formulaRegExp = /^\s*formula\s+(\w+)\s*=\s*(.+?)\s*;$/
const variableDefRegExp = /^\s*(?:\s*global)?\s*(\w+)\s*:\s*(?:(?:\[\s*(\w+)\s*\.\.\s*(\w+)\s*\])|(?:bool))(?:\s*init\s+(?:\w+))?\s*;\s*$/
const variableRegExp = /^\s*(?:\s*global)?\s*(\w+)\s*:\s*(?:(?:\[\s*(\w+)\s*\.\.\s*(\w+)\s*\])|(?:bool))(?:\s*init\s+(?:\w+))?\s*;\s*$/gm
const renameRegExp = /(\w+)\s*=\s*(\w+)/

const actionRegExp = /\[(.*)\]\s*(.*)\s*->(.*?);/gm
const moduleRegExp = /module\s+(\w*)(?:\s*=\s*(\w+))?(.*?)endmodule/gms

//Standard Icons
const inactive = new vscode.ThemeIcon("issues");
const active = new vscode.ThemeIcon("issue-closed");

//Decoration Design (colors swapped per user request)
const allowedActionDecoration = vscode.window.createTextEditorDecorationType({
    borderWidth: '1px',
    borderStyle: 'solid',
    overviewRulerColor: green,
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

//Decoration signifying that corresponding action can not proceed locally
const blockedActionDecoration = vscode.window.createTextEditorDecorationType({
    borderWidth: '1px',
    borderStyle: 'solid',
    overviewRulerColor: red,
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
        borderColor: grey
    },
    dark: {
        // this color will be used in dark color themes
        borderColor: grey
    }
});

// Responsibility gradient decorations (overlays independent from action enablement)
// We use subtle backgrounds so they can coexist; user may toggle later (future enhancement)
function makeRespDecoration(color) {
    return vscode.window.createTextEditorDecorationType({
        borderWidth: '1px',
        borderStyle: 'solid',
        overviewRulerColor: color,
        overviewRulerLane: vscode.OverviewRulerLane.Left,
        light: { backgroundColor: color, borderColor: color },
        dark: { backgroundColor: color + '80', borderColor: color }
    });
}

const respDecoVeryLow = makeRespDecoration(respCool);
const respDecoLow = makeRespDecoration(respLow);
const respDecoMid = makeRespDecoration(respMid);
const respDecoHigh = makeRespDecoration(respHigh);
const respDecoHot = makeRespDecoration(respHot);
const respDecoMax = makeRespDecoration(respMax);

class Decorator {
    constructor() {
        this._constantDef = new Map();
        this._formulaDef = new Map();
        this._variableDef = new Map();

        this._constantLoc = new Map();
        this._formulaLoc = new Map();
        this._variableLoc = new Map();

        this._states = new Map();
        this._activeState = new Map();
        this._projectID = null;

        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;

        // cache last responsibility mapping {componentId -> score}
        this._componentResp = null;
    }

    parseDocument(activeEditor) {
        const text = activeEditor.document.getText();

        this._constantDef = new Map();
        this._formulaDef = new Map();
        this._variableDef = new Map();

        this._constantLoc = new Map();
        this._formulaLoc = new Map();
        this._variableLoc = new Map();

        this.parseConstants(text);
        this.parseFormulas(text);
        this.parseVariables(text);
        this._parseRenamings(text);
    }

    register(id) {
        // When switching projects, clear previous responsibility overlay
        if (this._projectID !== id) {
            this.clearResponsibility();
        }
        this._projectID = id;
        this.reloadPanel()
    }

    checkRegistration(id) {
        return this._projectID == id;
    }

    matchVars(state) {
        for (let key in state.variables) {
            if (!this._variableDef.has(key)) {
                return false;
            }
        }
        return true;
    }

    updateInfo(activeEditor) {

        let state = this._activeState[this._projectID];

        if (!state || !this.matchVars(state.getState())) {
            activeEditor.setDecorations(allowedActionDecoration, []);
            activeEditor.setDecorations(blockedActionDecoration, []);
            activeEditor.setDecorations(partiallyBlockedActionDecoration, []);
            activeEditor.setDecorations(varDecoration, []);
            return;
        }

        state = state.getState();

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
            for (const m of modules) {
                // @ts-ignore
                if (m.startPosition.isBefore(startPos) & m.startPosition.isAfter(module.startPosition)) {
                    module = m;
                }
            }

            const action = module.actions.get(startPos.line);
            const actionName = match[1];

            const openLocal = action.enabled;
            // @ts-ignore
            const openGlobal = actions.get(actionName);

            const hovermessage = new vscode.MarkdownString(`Extended Guard:  \n  `, true);
            hovermessage.isTrusted = true;
            hovermessage.appendMarkdown(`${action.guard}`);

            if (openLocal) {
                if (openGlobal[0]) {
                    const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: hovermessage };
                    allowed.push(decoration);
                } else {
                    const blockingModules = openGlobal[1].map(item => {
                        const module = modules[item];
                        return `[${module.name}](command:moveTo?${module.startPosition.line})`;
                    }).join(",");
                    hovermessage.appendMarkdown(`\n\nBlocked by the following modules:  \n  ${blockingModules}`);
                    const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: hovermessage };
                    partBlocked.push(decoration);
                }
            } else {

                const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: hovermessage };
                blocked.push(decoration);
            }
        }

        activeEditor.setDecorations(allowedActionDecoration, allowed);
        activeEditor.setDecorations(blockedActionDecoration, blocked);
        activeEditor.setDecorations(partiallyBlockedActionDecoration, partBlocked);

        const varDeco = [];
        for (let key in state.variables) {
            const varReg = new RegExp(`\\b${key}\\b`, 'gm');
            while ((match = varReg.exec(document.getText()))) {
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                const hoverMessage = new vscode.MarkdownString();
                hoverMessage.appendMarkdown(`[${key}](command:moveTo?${this._variableLoc.get(key)}) = ${state.variables[key]}`);
                hoverMessage.isTrusted = true;
                const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: hoverMessage };
                varDeco.push(decoration);
            }
        }

        for (const [formulaReg, definition] of this._formulaDef) {
            const formEval = this.evaluate(this.fillExpression(definition), state);
            while ((match = formulaReg.exec(document.getText()))) {
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                const hoverMessage = new vscode.MarkdownString();
                hoverMessage.appendMarkdown(`[${match[0]}](command:moveTo?${this._formulaLoc.get(match[0])})==${formEval}`);
                hoverMessage.appendMarkdown(`  \n  Expanded Formula: ${definition}`);
                hoverMessage.isTrusted = true;
                const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: hoverMessage };
                varDeco.push(decoration);
            }
        }
        for (const [constReg, definition] of this._constantDef) {
            while ((match = constReg.exec(document.getText()))) {
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                const hoverMessage = new vscode.MarkdownString();
                hoverMessage.appendMarkdown(`[${match[0]}](command:moveTo?${this._constantLoc.get(match[0])})=${definition}`);
                hoverMessage.isTrusted = true;
                const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: hoverMessage };
                varDeco.push(decoration);
            }
        }
        activeEditor.setDecorations(varDecoration, varDeco);

        // Re-apply responsibility overlay if present
        if (this._componentResp) {
            this._applyResponsibility(activeEditor, this._componentResp);
        }
    }

    //Gathers all action guards in the document
    gatherInformation(document, state) {
        const modules = [];
        const enabledActionsGlobal = new Map();
        let matchModule;
        let i = 0;

        //Gather Information About every Module
        while ((matchModule = moduleRegExp.exec(document.getText()))) {
            const mPos = document.positionAt(matchModule.index);
            const name = matchModule[1];
            const altName = matchModule[2];
            let textContent = matchModule[3];

            if (altName != null) {
                const replacements = textContent.replace(/[|]/, "").split(",");

                const originalModule = modules.filter(module => {
                    return module.name == altName
                })

                textContent = originalModule[0].text;

                for (let j = 0; j < replacements.length; j++) {
                    const field = replacements[j];
                    const matched_r = field.match(renameRegExp)
                    if (matched_r != null) {
                        const existingField = matched_r[1]
                        const newField = matched_r[2]

                        textContent = textContent.replaceAll(existingField, newField);
                    }
                }
            }

            const actions = new Map();
            const enabledActions = new Map();
            let match;

            while ((match = actionRegExp.exec(textContent))) {
                const startLine = document.positionAt(matchModule.index + name.length + 8 + match.index).line;
                const action = match[1];
                const guard = this.fillExpression(match[2]);
                const enabled = this.evaluate(guard, state);

                actions.set(startLine, {
                    name: action,
                    guard: guard,
                    enabled: enabled,
                })

                if (!enabledActions.has(action)) {
                    enabledActions.set(action, enabled)
                } else {
                    const gEnabled = enabledActions.get(action);
                    enabledActions.set(action, enabled || gEnabled);
                }
            }

            const variables = new Map();

            while ((match = variableRegExp.exec(textContent))) {
                const varName = match[1];
                let minV;
                let maxV;
                if (match[2]) {
                    minV = match[2];
                    maxV = match[3];
                } else {
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
                startPosition: mPos,
                text: textContent
            })

            //Combine module enabled Information in order to determine general availability
            for (const [action, enabled] of enabledActions) {
                if (!enabledActionsGlobal.has(action)) {
                    if (enabled) {
                        enabledActionsGlobal.set(action, [true]);
                    } else {
                        enabledActionsGlobal.set(action, [false, [i]]);
                    }

                } else {
                    const gEnabled = enabledActionsGlobal.get(action)[0];
                    if (!gEnabled && !enabled) {
                        const prevCounter = enabledActionsGlobal.get(action)[1];
                        prevCounter.push(i);
                        enabledActionsGlobal.set(action, [false, prevCounter]);
                    }
                    if (gEnabled && !enabled) {
                        enabledActionsGlobal.set(action, [false, [i]]);
                    }
                }
            }
            i = i + 1;
        }

        return [modules, enabledActionsGlobal];
    }

    //Replace Expression with all Formulas Expanded and all constant values already filled in
    fillExpression(text) {
        let t = false;
        let expression = text;
        while (!t) {
            t = true;
            for (const [key, value] of this._formulaDef) {
                // eslint-disable-next-line no-unused-vars
                expression = expression.replaceAll(key, function (token) { t = false; return value; });
            }
        }
        t = false
        while (!t) {
            t = true
            for (const [key, value] of this._constantDef) {
                expression = expression.replaceAll(key, function (token) { t = false; return value; });
            }
        }
        return expression;
    }

    //Evaluate expanded expression
    evaluate(expression, state) {
        const exp = this.clean(expression);
        const res = mathjs.evaluate(exp, state.variables)
        return res;
    }

    //Translate prism Syntax into mathjs syntax
    clean(expression) {
        if (Array.isArray(expression)) {
            const e = expression.map(k => this.clean(k));
            return e;
        }
        let e = expression.replaceAll("&", " and ");
        e = e.replaceAll("|", " or ");
        e = e.replaceAll(/(?<!!|<|>)=/g, "==");
        e = e.replaceAll(/!(?!=)/g, " not ");
        return e;
    }

    parseConstants(text) {
        const lines = text.split(/\r\n|\r|\n/);

        //gather all declarations
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const matched_c = line.match(constantRegExp);
            if (matched_c != null) {
                this._constantDef.set(new RegExp(`\\b${matched_c[2]}\\b`, 'g'), matched_c[3]);
                this._constantLoc.set(matched_c[2], i);
            }
        }
    }

    parseFormulas(text) {
        const lines = text.split(/\r\n|\r|\n/);

        //gather all declarations
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const matched_f = line.match(formulaRegExp);
            if (matched_f != null) {
                this._formulaDef.set(new RegExp(`\\b${matched_f[1]}\\b`, 'g'), matched_f[2]);
                this._formulaLoc.set(matched_f[1], i);
            }
        }
    }

    parseVariables(text) {
        const lines = text.split(/\r\n|\r|\n/);

        //gather all declarations
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const matched_v = line.match(variableDefRegExp);
            if (matched_v != null) {
                if (matched_v[2]) {
                    this._variableDef.set(matched_v[1], [matched_v[2], matched_v[3]]);
                } else {
                    this._variableDef.set(matched_v[1], [0, 1]);
                }

                this._variableLoc.set(matched_v[1], i);
            }
        }
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

    _parseRenamings(text) {
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
                    if (this._variableDef.has(existingField)) {
                        this._variableDef.set(newField, this._variableDef.get(existingField));
                        this._variableLoc.set(newField, this._variableLoc.get(existingField));
                        continue;
                    }
                    if (this._formulaDef.has(existingField)) {
                        this._formulaDef.set(newField, this._formulaDef.get(existingField));
                        this._formulaLoc.set(newField, this._formulaLoc.get(existingField));
                        continue;
                    }
                    if (this._constantDef.has(existingField)) {
                        this._constantDef.set(newField, this._constantDef.get(existingField));
                        this._constantLoc.set(newField, this._constantLoc.get(existingField));
                        continue;
                    }
                }
            }
        }
        return;
    }

    getChildren(element) {
        if (element) {
            return element._children;
        } else {
            return this.currentStates();
        }
    }

    getTreeItem(element) {
        return element;
    }

    getParent(element) {
        return element.getParent();
    }

    selectState(item) {
        if (item.getParent()) {
            this.selectState(item.getParent());
        } else {
            if (this._activeState[this._projectID]) {
                this._activeState[this._projectID].deactivate();
            }
            this._activeState[this._projectID] = item;
            this.reloadPanel();
            this.refreshPage();
        }
    }

    unselectState(item) {
        if (!this._activeState) {
            return;
        }
        if (item.getParent()) {
            this.unselectState(item.getParent());
        } else {
            this._activeState[this._projectID] = null;
            this.reloadPanel();
            this.refreshPage();
        }
    }

    reloadPanel() {
        this._onDidChangeTreeData.fire(undefined);
    }

    refreshPage() {
        const activeEditor = vscode.window.activeTextEditor;

        if (activeEditor) {
            this.updateInfo(activeEditor);
        }
    }

    currentStates() {
        if (this._projectID == null) {
            return [];
        }

        return this._states[this._projectID];
    }

    updateStates(states, id) {
        if (!states) {
            states = [];
        }
        this._states[id] = [];
        this._count = 0;
        states.forEach(element => {
            const si = new StateItem(element.id, this._count++, null, element);
            this._states[id].push(si);
            this.parseStateData(element, si);
        });
        if (this._states[id].length > 0) {
            this._activeState[id] = this._states[id][0].activate();
        } else {
            this._activeState[id] = null;
        }
        this.reloadPanel()
    }

    parseStateData(data, si) {
        for (let key in data.variables) {
            const value = `${data.variables[key]}`;
            const sx = new StateItem(key + " : " + value, this._count++, si);
            //sx.add_child(new StateItem(value, this._count++, sx));
            si.add_child(sx);
        }
    }

}

// Responsibility extension methods
Decorator.prototype.updateResponsibility = function(activeEditor, componentResp) {
    // Store for subsequent state changes
    this._componentResp = componentResp;
    if (!activeEditor) {
        activeEditor = vscode.window.activeTextEditor;
    }
    if (!activeEditor) return;
    this._applyResponsibility(activeEditor, componentResp);
};

Decorator.prototype.clearResponsibility = function() {
    this._componentResp = null;
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) return;
    activeEditor.setDecorations(respDecoVeryLow, []);
    activeEditor.setDecorations(respDecoLow, []);
    activeEditor.setDecorations(respDecoMid, []);
    activeEditor.setDecorations(respDecoHigh, []);
    activeEditor.setDecorations(respDecoHot, []);
    activeEditor.setDecorations(respDecoMax, []);
};

// Internal: map component IDs to document ranges heuristically
Decorator.prototype._applyResponsibility = function(activeEditor, componentResp) {
    if (!activeEditor || activeEditor.document.languageId !== 'mdp') return;
    const text = activeEditor.document.getText();

    // Build regex lists for modules, variables, actions
    // Component naming conventions from backend:
    // module_<name>, variable_<name>, action_<label>

    const moduleRanges = new Map();
    const moduleRegex = /module\s+(\w+)/gm;
    let match;
    while ((match = moduleRegex.exec(text))) {
        const start = activeEditor.document.positionAt(match.index);
        const end = activeEditor.document.positionAt(match.index + match[0].length);
        moduleRanges.set(match[1], new vscode.Range(start, end));
    }

    const variableRanges = new Map();
    const variableRegex = /(?:global\s+)?(\w+)\s*:\s*(?:\[.*?\]|bool).*?;/gm;
    while ((match = variableRegex.exec(text))) {
        const start = activeEditor.document.positionAt(match.index);
        const end = activeEditor.document.positionAt(match.index + match[1].length);
        variableRanges.set(match[1], new vscode.Range(start, end));
    }

    const actionRanges = new Map();
    const actionRegex = /\[(\w+)\]\s*[^-]*->/gm;
    while ((match = actionRegex.exec(text))) {
        const start = activeEditor.document.positionAt(match.index);
        const end = activeEditor.document.positionAt(match.index + match[0].length);
        actionRanges.set(match[1], new vscode.Range(start, end));
    }

    // Buckets
    const veryLow = [];
    const low = [];
    const mid = [];
    const high = [];
    const hot = [];
    const max = [];

    const pushDeco = (rangeList, range, id, score) => {
        if (!range) return;
        const hover = new vscode.MarkdownString(`Responsibility(${id}) = ${score.toFixed(3)}`);
        hover.isTrusted = true;
        rangeList.push({ range, hoverMessage: hover });
    };

    // Normalize scores 0..1 (backend already 0..1 but guard anyway)
    for (const [id, val] of Object.entries(componentResp)) {
        const score = Math.max(0, Math.min(1, val));
        let range = null;
        if (id.startsWith('module_')) {
            range = moduleRanges.get(id.substring(7));
        } else if (id.startsWith('variable_')) {
            range = variableRanges.get(id.substring(9));
        } else if (id.startsWith('action_')) {
            range = actionRanges.get(id.substring(7));
        }

        if (!range) continue;
        if (score >= 0.85)      pushDeco(max, range, id, score);
        else if (score >= 0.70) pushDeco(hot, range, id, score);
        else if (score >= 0.55) pushDeco(high, range, id, score);
        else if (score >= 0.40) pushDeco(mid, range, id, score);
        else if (score >= 0.25) pushDeco(low, range, id, score);
        else                    pushDeco(veryLow, range, id, score);
    }

    activeEditor.setDecorations(respDecoVeryLow, veryLow);
    activeEditor.setDecorations(respDecoLow, low);
    activeEditor.setDecorations(respDecoMid, mid);
    activeEditor.setDecorations(respDecoHigh, high);
    activeEditor.setDecorations(respDecoHot, hot);
    activeEditor.setDecorations(respDecoMax, max);
};

class StateItem extends vscode.TreeItem {
    constructor(label, number, parent, state = null) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this._label = label;
        this._number = number;
        this._children = [];
        this._parent = parent;
        this._state = state;

        if (parent) {
            this.contextValue = "Child";
        } else {
            this.contextValue = "State";
            this.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
        }
    }

    add_child(child) {
        this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        this._children.push(child);
    }

    getParent() {
        return this._parent;
    }

    getState() {
        return this._state;
    }

    activate() {
        this.checkboxState = vscode.TreeItemCheckboxState.Checked;
        return this;
    }

    deactivate() {
        this.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
    }
}



module.exports = { Decorator }