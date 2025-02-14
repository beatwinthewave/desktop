import * as net from 'net';
import * as fsPromises from 'node:fs/promises';
import path from 'node:path';
import fs from 'fs';
import si from 'systeminformation';
import { exec } from 'child_process';
import { promisify } from 'util';
import log from 'electron-log/main';

export async function pathAccessible(path: string): Promise<boolean> {
  try {
    await fsPromises.access(path);
    return true;
  } catch {
    return false;
  }
}

export function getModelsDirectory(comfyUIBasePath: string): string {
  return path.join(comfyUIBasePath, 'models');
}

export function findAvailablePort(host: string, startPort: number, endPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    function tryPort(port: number) {
      if (port > endPort) {
        reject(new Error(`No available ports found between ${startPort} and ${endPort}`));
        return;
      }

      const server = net.createServer();
      server.listen(port, host, () => {
        server.once('close', () => {
          resolve(port);
        });
        server.close();
      });
      server.on('error', () => {
        tryPort(port + 1);
      });
    }

    tryPort(startPort);
  });
}

/**
 * Rotate old log files by adding a timestamp to the end of the file.
 * @param logDir The directory to rotate the logs in.
 * @param baseName The base name of the log file.
 */
export function rotateLogFiles(logDir: string, baseName: string) {
  const currentLogPath = path.join(logDir, `${baseName}.log`);
  if (fs.existsSync(currentLogPath)) {
    const stats = fs.statSync(currentLogPath);
    const timestamp = stats.birthtime.toISOString().replace(/[:.]/g, '-');
    const newLogPath = path.join(logDir, `${baseName}_${timestamp}.log`);
    fs.renameSync(currentLogPath, newLogPath);
  }
}

const execAsync = promisify(exec);

interface HardwareValidation {
  isValid: boolean;
  error?: string;
}

/**
 * Validate the system hardware requirements for ComfyUI.
 */
export async function validateHardware(): Promise<HardwareValidation> {
  try {
    // Only ARM Macs are supported.
    if (process.platform === 'darwin') {
      const cpu = await si.cpu();
      const isArmMac = cpu.manufacturer === 'Apple';

      if (!isArmMac) {
        return {
          isValid: false,
          error: 'ComfyUI requires Apple Silicon (M1/M2/M3) Mac. Intel-based Macs are not supported.',
        };
      }

      return { isValid: true };
    }

    // Windows NVIDIA GPU validation
    if (process.platform === 'win32') {
      const graphics = await si.graphics();
      const hasNvidia = graphics.controllers.some((controller) => controller.vendor.toLowerCase().includes('nvidia'));

      if (!hasNvidia) {
        try {
          // wmic is unreliable. Check in PS.
          const res = await execAsync(
            'powershell.exe -c "$n = \'*NVIDIA*\'; Get-CimInstance win32_videocontroller | ? { $_.Name -like $n -or $_.VideoProcessor -like $n -or $_.AdapterCompatibility -like $n }"'
          );
          if (!res?.stdout) throw new Error('No video card');
          return { isValid: true };
        } catch {
          try {
            await execAsync('nvidia-smi');
            return { isValid: true };
          } catch {
            return {
              isValid: false,
              error: 'ComfyUI requires an NVIDIA GPU on Windows. No NVIDIA GPU was detected.',
            };
          }
        }
      }

      return { isValid: true };
    }

    return {
      isValid: false,
      error: 'ComfyUI currently supports only Windows (NVIDIA GPU) and Apple Silicon Macs.',
    };
  } catch (error) {
    log.error('Error validating hardware:', error);
    return {
      isValid: false,
      error: 'Failed to validate system hardware requirements. Please check the logs for more details.',
    };
  }
}
