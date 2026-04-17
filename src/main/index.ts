import { app, BrowserWindow, shell, protocol } from 'electron'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { registerIpcHandlers } from './ipc.js'
import { startStreamServer, stopStreamServer } from './stream-server.js'
import { flushVideoProgress } from './store.js'

const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false
    }
  }
])

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f12',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  // Allow the renderer to reference local poster/thumbnail files by path via
  // a custom `local://` protocol.
  protocol.handle('local', async (request) => {
    try {
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.pathname)
      const info = await stat(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const stream = createReadStream(filePath)
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        headers: {
          'Content-Type': IMAGE_MIME[ext] ?? 'application/octet-stream',
          'Content-Length': String(info.size)
        }
      })
    } catch (err) {
      return new Response((err as Error).message, { status: 404 })
    }
  })

  await startStreamServer()
  registerIpcHandlers()

  // Persist buffered playback progress to disk at a modest cadence.
  setInterval(flushVideoProgress, 1000)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopStreamServer()
  flushVideoProgress()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  flushVideoProgress()
})
