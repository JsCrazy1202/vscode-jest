import { ProjectWorkspace } from 'jest-editor-support'
import { JestProcess } from './JestProcess'
import { WatchMode } from '../Jest'

export class JestProcessManager {
  private projectWorkspace: ProjectWorkspace
  private jestProcesses: Array<JestProcess> = []
  private runAllTestsFirstInWatchMode: boolean

  constructor({
    projectWorkspace,
    runAllTestsFirstInWatchMode = true,
  }: {
    projectWorkspace: ProjectWorkspace
    runAllTestsFirstInWatchMode?: boolean
  }) {
    this.projectWorkspace = projectWorkspace
    this.runAllTestsFirstInWatchMode = runAllTestsFirstInWatchMode
  }

  private removeJestProcessReference(jestProcess: JestProcess) {
    const index = this.jestProcesses.indexOf(jestProcess)
    if (index !== -1) {
      this.jestProcesses.splice(index, 1)
    }
  }

  private runJest({
    watchMode,
    keepAlive,
    exitCallback,
  }: {
    watchMode: WatchMode
    keepAlive: boolean
    exitCallback: Function
  }) {
    const jestProcess = new JestProcess({
      projectWorkspace: this.projectWorkspace,
      watchMode,
      keepAlive,
    })

    this.jestProcesses.unshift(jestProcess)

    jestProcess.onExit(exitCallback)
    return jestProcess
  }

  private run({
    watchMode,
    keepAlive,
    exitCallback,
  }: {
    watchMode: WatchMode
    keepAlive: boolean
    exitCallback: Function
  }) {
    return this.runJest({
      watchMode,
      keepAlive,
      exitCallback: exitedJestProcess => {
        exitCallback(exitedJestProcess)
        if (!exitedJestProcess.keepAlive) {
          this.removeJestProcessReference(exitedJestProcess)
        }
      },
    })
  }

  private runAllTestsFirst(onExit: Function) {
    return this.runJest({
      watchMode: WatchMode.None,
      keepAlive: false,
      exitCallback: onExit,
    })
  }

  public startJestProcess(
    {
      exitCallback = () => {},
      watchMode = WatchMode.None,
      keepAlive = false,
    }: {
      exitCallback?: Function
      watchMode?: WatchMode
      keepAlive?: boolean
    } = {}
  ): JestProcess {
    if (watchMode !== WatchMode.None && this.runAllTestsFirstInWatchMode) {
      return this.runAllTestsFirst(exitedJestProcess => {
        this.removeJestProcessReference(exitedJestProcess)
        const jestProcessInWatchMode = this.run({
          watchMode: WatchMode.Watch,
          keepAlive,
          exitCallback,
        })
        exitCallback(exitedJestProcess, jestProcessInWatchMode)
      })
    } else {
      return this.run({
        watchMode,
        keepAlive,
        exitCallback,
      })
    }
  }

  public stopAll() {
    const processesToRemove = [...this.jestProcesses]
    this.jestProcesses = []
    return Promise.all(processesToRemove.map(jestProcess => jestProcess.stop()))
  }

  public stopJestProcess(jestProcess: JestProcess) {
    this.removeJestProcessReference(jestProcess)
    return jestProcess.stop()
  }

  public get numberOfProcesses() {
    return this.jestProcesses.length
  }
}
