import * as path from 'path';
import * as vscode from 'vscode';
import * as child_process from 'child_process';
import { runTask } from './utils/tasks';
import { cancel } from './utils/generic';
import { pipPath, launchPath} from './paths';
import { AddonFolder } from './addon_folder';
import { getServerPort } from './communication';
import { BlenderFolder } from './blender_folder';
import { getConfiguration } from './utils/utils';


export class BlenderExecutable {
    data : BlenderPathData;

    constructor(data : BlenderPathData) {
        this.data = data;
    }

    public static async GetAny() {
        let data = await getFilteredBlenderPath('Blender Executable', () => true, () => {});
        return new BlenderExecutable(data);
    }

    public static async GetDebug() {
        let data = await getFilteredBlenderPath(
            'Debug Build',
            item => item.isDebug,
            item => { item.isDebug = true; }
        );
        return new BlenderExecutable(data);
    }

    get path() {
        return this.data.path;
    }

    public async launch() {
        let execution = new vscode.ProcessExecution(
            this.path,
            getBlenderLaunchArgs(),
            {env: await getBlenderLaunchEnv()}
        );

        await runTask('blender', execution);
    }

    public async launchDebug(folder : BlenderFolder) {
        let configuration = {
            name: 'Debug Blender',
            type: 'cppdbg',
            request: 'launch',
            program: this.data.path,
            args: ['--debug'].concat(getBlenderLaunchArgs()),
            env: await getBlenderLaunchEnv(),
            stopAtEntry: false,
            MIMode: 'gdb',
            cwd: folder.uri.fsPath,
        };
        vscode.debug.startDebugging(folder.folder, configuration);
    }
}

interface BlenderPathData {
    path : string;
    name : string;
    isDebug : boolean;
}

async function getFilteredBlenderPath(
        openLabel: string,
        predicate : (item : BlenderPathData) => boolean,
        setSettings : (item : BlenderPathData) => void) : Promise<BlenderPathData>
{
    let config = getConfiguration();
    let allBlenderPaths = <BlenderPathData[]>config.get('blenderPaths');
    let usableBlenderPaths = allBlenderPaths.filter(predicate);

    if (usableBlenderPaths.length === 0) {
        let blenderPath = await askUser_BlenderPath(openLabel);
        let item = {
            path: blenderPath,
            name: path.basename(path.dirname(blenderPath)),
            isDebug: false
        };
        setSettings(item);
        allBlenderPaths.push(item);
        config.update('blenderPaths', allBlenderPaths, vscode.ConfigurationTarget.Global);
        return item;
    } else if (usableBlenderPaths.length === 1) {
        return usableBlenderPaths[0];
    } else {
        let names = usableBlenderPaths.map(item => item.name);
        let selectedName = await vscode.window.showQuickPick(names);
        if (selectedName === undefined) return Promise.reject(cancel());
        return <BlenderPathData>usableBlenderPaths.find(item => item.name === selectedName);
    }
}

async function askUser_BlenderPath(openLabel : string) {
    let value = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: openLabel
        });
    if (value === undefined) return Promise.reject(cancel());
    let filepath = value[0].fsPath;
    await testIfPathIsBlender(filepath);
    return filepath;
}

async function testIfPathIsBlender(filepath : string) {
    let name : string = path.basename(filepath);

    if (!name.toLowerCase().startsWith('blender')) {
        return Promise.reject(new Error('Expected executable name to begin with \'blender\''));
    }

    let testString = '###TEST_BLENDER###';
    let command = `${filepath} --factory-startup -b --python-expr "import sys;print('${testString}');sys.stdout.flush();sys.exit()"`;

    return new Promise<void>((resolve, reject) => {
        child_process.exec(command, {}, (err, stdout, stderr) => {
            let text = stdout.toString();
            if (!text.includes(testString)) {
                reject(new Error('Path is not Blender.'));
            } else {
                resolve();
            }
        });
    });
}

function getBlenderLaunchArgs() {
    return ['--python', launchPath];
}

async function getBlenderLaunchEnv() {
    let config = getConfiguration();
    let addons = await AddonFolder.All();
    let loadDirs = addons.map(a => a.getLoadDirectory());

    return {
        ADDON_DIRECTORIES_TO_LOAD: JSON.stringify(loadDirs),
        EDITOR_PORT: getServerPort().toString(),
        PIP_PATH: pipPath,
        ALLOW_MODIFY_EXTERNAL_PYTHON: <boolean>config.get('allowModifyExternalPython') ? 'yes' : 'no',
    };
}