import { ProjectWorkspace } from 'jest-editor-support'
import { JestProcess } from './JestProcess'

export class JestProcessManager {
  private projectWorkspace: ProjectWorkspace
  private jestProcess: JestProcess
  private jestProcessInWatchMode: JestProcess

  constructor({ projectWorkspace }: { projectWorkspace: ProjectWorkspace }) {
    this.projectWorkspace = projectWorkspace
  }

  private onJestProcessExit(jestProcess, exitCallback) {
    this.jestProcessInWatchMode = new JestProcess({
      projectWorkspace: this.projectWorkspace,
      watchMode: true,
    })
    exitCallback(jestProcess, this.jestProcessInWatchMode)
    this.jestProcessInWatchMode.onExit(exitCallback)
  }

  private handleWatchMode(exitCallback) {
    this.jestProcess.onExit(jestProcess => this.onJestProcessExit(jestProcess, exitCallback))
  }

  private handleNonWatchMode(exitCallback) {
    this.jestProcess.onExit(exitCallback)
  }

  public startJestProcess(
    {
      exitCallback = () => {},
      watch = false,
    }: {
      exitCallback?: () => void
      watch?: boolean
    } = {
      exitCallback: () => {},
      watch: false,
    }
  ): JestProcess {
    this.jestProcess = new JestProcess({
      projectWorkspace: this.projectWorkspace,
      watchMode: false,
    })

    if (watch) {
      this.handleWatchMode(exitCallback)
    } else {
      this.handleNonWatchMode(exitCallback)
    }

    return this.jestProcess
  }
}
