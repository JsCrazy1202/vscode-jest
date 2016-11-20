'use strict';

import * as vscode from 'vscode';
import {JestRunner} from './jest_runner';
import {TestReconciler, TestReconcilationState} from './test_reconciler';
import {TestFileParser, ItBlock} from './test_file_parser';
import * as decorations from './decorations';

var extensionInstance: JestExt;

export interface JestFileResults {
    name: string;
    summary: string;
    message: string;
    status: "failed" | "passed";
    startTime:number;
    endTime:number;
    assertionResults: JestAssertionResults[];
}

export interface JestAssertionResults {
    name: string;
    title: string;
    status: "failed" | "passed";
    failureMessages: string[];
}

export interface JestTotalResults {
    success:boolean;
    startTime:number;
    numTotalTests:number;
    numTotalTestSuites:number;
    numRuntimeErrorTestSuites:number;
    numPassedTests:number;
    numFailedTests:number;
    numPendingTests:number;
    testResults: JestFileResults[];
}

export function activate(context: vscode.ExtensionContext) {
    let channel = vscode.window.createOutputChannel("Jest");
    extensionInstance = new JestExt(channel, context.subscriptions);
    extensionInstance.startProcess();
    
    vscode.commands.registerCommand("io.orta.show-jest-output", ()=> {
        channel.show();
    });

    // Setup the file change watchers
	var activeEditor = vscode.window.activeTextEditor;
	if (activeEditor) {
		extensionInstance.triggerUpdateDecorations(activeEditor);
	}

	vscode.window.onDidChangeActiveTextEditor(editor => {
		activeEditor = editor;
		if (editor) {
			extensionInstance.triggerUpdateDecorations(activeEditor);	
		}
	}, null, context.subscriptions);
	
    vscode.workspace.onDidSaveTextDocument(document => {
        if (document) {
            extensionInstance.triggerUpdateDecorations(vscode.window.activeTextEditor);
        }
    });

	vscode.workspace.onDidChangeTextDocument(event => {
		if (activeEditor && event.document === activeEditor.document) {
			extensionInstance.triggerUpdateDecorations(activeEditor);
            
		}
	}, null, context.subscriptions);
    
}

class JestExt  {
    private jestProcess: JestRunner;
    private parser: TestFileParser;
    private reconciler: TestReconciler;
    
    // So you can read what's going on
    private channel: vscode.OutputChannel;
    
    // Memory management
    private workspaceDisposal: { dispose(): any }[];
    private perFileDisposals: { dispose(): any }[];
    
    // The bottom status bar
    private statusBarItem: vscode.StatusBarItem;
    // The ability to show fails in the problems section
    private failDiagnostics: vscode.DiagnosticCollection;

    private passingItStyle: vscode.TextEditorDecorationType;
    private failingItStyle: vscode.TextEditorDecorationType;
    private unknownItStyle: vscode.TextEditorDecorationType;

    private clearOnNextInput: boolean;

    public constructor(outputChannel: vscode.OutputChannel, disposal:  { dispose(): any }[]) {
        this.channel = outputChannel;
        this.workspaceDisposal = disposal;
        this.perFileDisposals = [];
        this.parser = new TestFileParser(); 
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.failDiagnostics = vscode.languages.createDiagnosticCollection("Jest");
        this.clearOnNextInput = true;
        this.reconciler = new TestReconciler();
    }

    startProcess() {
        this.jestProcess = new JestRunner();

        this.jestProcess.on('debuggerComplete', () => {
            console.log("Closed");

        }).on('executableJSON', (data: any) => {
            console.log("JSON data from Jest recieved: ", data);
            this.updateWithData(data);
            this.triggerUpdateDecorations(vscode.window.activeTextEditor);
            this.clearOnNextInput = true;

        }).on('executableOutput', (output: string) => {
            if (!output.includes("Watch Usage")){
                this.channel.appendLine(output);
            }

        }).on('executableStdErr', (error: Buffer) => {
            if (this.clearOnNextInput){
                this.clearOnNextInput = false;
                this.testsHaveStartedRunning();
            }
            this.channel.appendLine(error.toString());
        }).on('nonTerminalError', (error: string) => {
            console.log("Err?  ] " + error.toString());
        }).on('exception', result => {
            console.log("\nException raised: [" + result.type + "]: " + result.message + "\n",'stderr');
        }).on('terminalError', (error: string) => {
            console.log("\nException raised: " + error);
        });

        this.setupDecorators();
        this.setupStatusBar();
    }

    async triggerUpdateDecorations(editor: vscode.TextEditor) {
        try {
            await this.parser.run(editor.document.uri.fsPath);
            const itBlocks = this.parser.itBlocks;
            const successes: ItBlock[] = [];
            const fails: ItBlock[] = [];
            const unknowns: ItBlock[] = []; 

            itBlocks.forEach(it => {
                switch(this.reconciler.stateForTestFile(editor.document.uri)) {
                    case TestReconcilationState.KnownSuccess: 
                        successes.push(it); break;
                    case TestReconcilationState.KnownFail: 
                        fails.push(it); break;
                    case TestReconcilationState.Unknown: 
                        unknowns.push(it); break;
                }
            });

            const styleMap = [ 
                { data: successes, style: this.passingItStyle }, 
                { data: fails, style: this.failingItStyle }, 
                { data: unknowns, style: this.unknownItStyle }
            ];
            styleMap.forEach(style => {
                let decorators = this.generateDecoratorsForJustIt(style.data, editor);
                editor.setDecorations(style.style, decorators);                
            });

        } catch(e) {
            console.log(`Error Parsing :${editor.document.uri.fsPath} for VS Code Jest.`, e);
        }
    }

    setupStatusBar() { 
        this.statusBarItem.show();
        this.statusBarItem.command = "io.orta.show-jest-output";
        this.testsHaveStartedRunning();
    }

    setupDecorators() {
        this.passingItStyle = decorations.passingItName();
        this.failingItStyle = decorations.failingItName();
        this.unknownItStyle = decorations.notRanItName();
    }

    testsHaveStartedRunning() {
        this.channel.clear();
        this.statusBarItem.text = "Jest: $(sync)";
    }

    updateWithData(data: JestTotalResults) {
        this.reconciler.updateFileWithJestStatus(data);
        if (data.success) {
            this.statusBarItem.text = "Jest: $(check)";

        } else {
            this.statusBarItem.text = "Jest: $(alert)";

            this.failDiagnostics.clear();
            
            const fails = this.reconciler.failedStatuses();
            fails.forEach( (fail) => {
                fail.assertions.forEach((assertion) =>  { 
                    const daig = new vscode.Diagnostic(
                        new vscode.Range(assertion.line || 0, 0, 0, 0),
                        assertion.terseMessage,
                        vscode.DiagnosticSeverity.Error
                    );
                    const uri = vscode.Uri.file(fail.file);
                    this.failDiagnostics.set(uri, [daig]);
                });
            });
        }
    }

    generateDecoratorsForJustIt(blocks: ItBlock[], state: TestReconcilationState): vscode.DecorationOptions[] {
        const nameForState = (name: string, state: TestReconcilationState): string => {
            switch (state) {
                    case TestReconcilationState.KnownSuccess: 
                        return 'Passed';
                    case TestReconcilationState.KnownFail: 
                        return 'Failed';
                    case TestReconcilationState.Unknown: 
                        return 'Not ran';
                }
        };
        return blocks.map((it)=> {
            return {
                // VS Code is 1 based, babylon is 0 based
                range: new vscode.Range(it.start.line - 1, it.start.column, it.start.line - 1, it.start.column + 2),
                hoverMessage: nameForState(it.name, state),
            };
        });
    }

    deactivate() {
        this.jestProcess.closeProcess();
    }
}

export function deactivate() {
    extensionInstance.deactivate();
}