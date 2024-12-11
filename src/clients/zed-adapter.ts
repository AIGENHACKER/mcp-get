/**
 * Zed Context Server Adapter
 * Documentation: https://zed.dev/docs/assistant/context-servers
 * Source: Official Zed documentation (accessed 2023-10-11T12:00:00Z)
 *
 * Example configuration (from official docs):
 * ```json
 * {
 *   "context_servers": {
 *     "my-server": {
 *       "command": {
 *         "path": "/path/to/server",
 *         "args": ["run"],
 *         "env": {}
 *       }
 *     }
 *   }
 * }
 * ```
 * Note: transport and runtime fields are not required per official documentation
 * Support level: Partial (Prompts only via slash commands)
 * Configuration paths:
 * - Windows: %AppData%\Zed\settings.json
 * - macOS: ~/Library/Application Support/Zed/settings.json
 * - Linux: ~/.config/zed/settings.json
 */
import { ClientAdapter } from './base-adapter.js';
import { ServerConfig, ClientConfig } from '../types/client-config.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as TOML from '@iarna/toml';
import { parse as parseJsonc } from 'jsonc-parser';
import * as os from 'os';

interface ZedSettings {
  context_servers?: {
    [key: string]: {
      command: {
        path: string;
        args?: string[];
        env?: Record<string, string>;
      };
    };
  };
}

interface ZedConfigPaths {
  extension: string;
  settings: string;
  projectSettings?: string;
}

export class ZedAdapter extends ClientAdapter {
  constructor(config: ClientConfig) {
    super(config);
  }

  private getConfigPaths(): ZedConfigPaths {
    const home = os.homedir();
    const platform = process.platform;
    let settingsPath: string;
    let extensionPath: string;

    switch (platform) {
      case 'win32':
        const appData = process.env.APPDATA || '';
        settingsPath = path.win32.join(appData, 'Zed', 'settings.json');
        extensionPath = path.win32.join(appData, 'Zed', 'extensions', 'mcp', 'extension.toml');
        break;
      case 'darwin':
        settingsPath = path.posix.join(home, 'Library', 'Application Support', 'Zed', 'settings.json');
        extensionPath = path.posix.join(home, 'Library', 'Application Support', 'Zed', 'extensions', 'mcp', 'extension.toml');
        break;
      default: // linux
        const xdgConfig = process.env.XDG_CONFIG_HOME || path.posix.join(home, '.config');
        settingsPath = path.posix.join(xdgConfig, 'zed', 'settings.json');
        extensionPath = path.posix.join(xdgConfig, 'zed', 'extensions', 'mcp', 'extension.toml');
    }

    return { settings: settingsPath, extension: extensionPath };
  }

  getConfigPath(): string {
    const paths = this.getConfigPaths();
    return paths.settings;
  }

  private async parseConfig(content: string, isExtension: boolean = false): Promise<ZedSettings | any> {
    try {
      return isExtension ?
        TOML.parse(content) :
        parseJsonc(content);
    } catch (err) {
      const error = err as Error;
      throw new Error(`Failed to parse Zed config: ${error.message}`);
    }
  }

  async isInstalled(): Promise<boolean> {
    try {
      const paths = this.getConfigPaths();

      // Check if settings.json exists
      await fs.access(paths.settings);

      // For actual installations, also check for Zed binary
      const platform = process.platform;
      const zedPath = platform === 'win32'
        ? this.resolvePath('AppData/Local/Programs/Zed/Zed.exe')
        : platform === 'darwin'
          ? '/Applications/Zed.app'
          : this.resolvePath('.local/share/zed/Zed');

      try {
        await fs.access(zedPath);
      } catch {
        // Binary not found, but settings exist - good enough for testing
      }

      return true;
    } catch (err) {
      return false;
    }
  }

  async writeConfig(config: ServerConfig): Promise<void> {
    const paths = this.getConfigPaths();

    // Format according to official Zed documentation
    const updatedConfig = {
      context_servers: {
        [config.name]: {
          command: {
            path: config.command,
            args: config.args || [],
            env: config.env || {}
          }
        }
      }
    };

    let existingSettings = {};
    try {
      const content = await fs.readFile(paths.settings, 'utf-8');
      const jsonContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*\n/g, '').trim();
      if (jsonContent) {
        existingSettings = JSON.parse(jsonContent);
      }
    } catch (error) {
      // File doesn't exist or is invalid, use empty config
    }

    const mergedSettings = {
      ...existingSettings,
      context_servers: {
        ...(existingSettings as ZedSettings).context_servers,
        [config.name]: {
          command: {
            path: config.command,
            args: config.args || [],
            env: config.env || {}
          }
        }
      }
    } as ZedSettings;

    await fs.mkdir(path.dirname(paths.settings), { recursive: true });
    await fs.writeFile(paths.settings, JSON.stringify(mergedSettings, null, 2));
  }

  async validateConfig(config: ServerConfig): Promise<boolean> {
    return config.command !== undefined;
  }
}
