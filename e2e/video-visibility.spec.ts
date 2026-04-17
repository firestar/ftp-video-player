import { test, expect, Page } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const harnessUrl = pathToFileURL(
  path.resolve(__dirname, 'fixtures/player-harness.html')
).toString()

async function waitUntilPlaying(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const h = (window as unknown as { __harness: { play(): Promise<void> } }).__harness
    await h.play()
  })
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __harness: { isPaused(): boolean } }).__harness.isPaused()
      )
    )
    .toBe(false)
  await expect
    .poll(() =>
      page.evaluate(() => document.body.classList.contains('video-playing'))
    )
    .toBe(true)
}

async function expectVideoVisible(page: Page): Promise<void> {
  const video = page.locator('#harness-video')
  await expect(video).toBeVisible()

  const dims = await video.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return {
      width: rect.width,
      height: rect.height,
      display: style.display,
      visibility: style.visibility,
      opacity: Number(style.opacity)
    }
  })

  expect(dims.display).not.toBe('none')
  expect(dims.visibility).toBe('visible')
  expect(dims.opacity).toBeGreaterThan(0)
  // Arbitrary but safe lower bound – real playback in the app gets the whole
  // main column, which is well over 200px wide in any sensible viewport.
  expect(dims.width).toBeGreaterThan(200)
  expect(dims.height).toBeGreaterThan(100)
}

test.describe('video visibility during playback', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(harnessUrl)
    await page.waitForFunction(
      () => typeof (window as unknown as { __harness?: unknown }).__harness !== 'undefined'
    )
  })

  test('video element is visible before playback starts', async ({ page }) => {
    await expectVideoVisible(page)
    await expect(page.locator('body')).not.toHaveClass(/video-playing/)
  })

  test('video stays visible once playback starts', async ({ page }) => {
    await waitUntilPlaying(page)
    await expectVideoVisible(page)

    // Sanity check: playback is actually advancing so the element really is
    // showing live frames rather than a frozen first frame.
    const t0 = await page.evaluate(() =>
      (window as unknown as { __harness: { currentTime(): number } }).__harness.currentTime()
    )
    await page.waitForTimeout(400)
    const t1 = await page.evaluate(() =>
      (window as unknown as { __harness: { currentTime(): number } }).__harness.currentTime()
    )
    expect(t1).toBeGreaterThan(t0)
  })

  test('video remains visible continuously across several frames', async ({ page }) => {
    await waitUntilPlaying(page)
    for (let i = 0; i < 6; i++) {
      await expectVideoVisible(page)
      await page.waitForTimeout(200)
    }
  })

  test('sidebar collapses but video remains visible and grows', async ({ page }) => {
    const video = page.locator('#harness-video')
    const sidebar = page.locator('.sidebar')

    const beforeWidth = (await video.boundingBox())!.width
    const sidebarBefore = (await sidebar.boundingBox())!.width
    expect(sidebarBefore).toBeGreaterThan(100)

    await waitUntilPlaying(page)
    await expectVideoVisible(page)

    // The production CSS collapses the sidebar to 0 while playing; the video
    // column should therefore gain width, not lose it.
    const sidebarAfter = (await sidebar.boundingBox())!.width
    expect(sidebarAfter).toBeLessThan(sidebarBefore)

    const afterWidth = (await video.boundingBox())!.width
    expect(afterWidth).toBeGreaterThanOrEqual(beforeWidth)
  })

  test('video stays visible after pausing', async ({ page }) => {
    await waitUntilPlaying(page)
    await expectVideoVisible(page)

    await page.evaluate(() =>
      (window as unknown as { __harness: { pause(): void } }).__harness.pause()
    )
    await expect
      .poll(() =>
        page.evaluate(() => document.body.classList.contains('video-playing'))
      )
      .toBe(false)

    await expectVideoVisible(page)
  })
})
