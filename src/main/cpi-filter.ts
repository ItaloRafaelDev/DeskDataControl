import type { Frame, Locator, Page } from 'playwright'

// Selectors and event semantics characterized in the reference controller.
export const CPI_FILTER = {
  advanced: 'a.link:has(i[title="Filtros Avançados"])',
  target: 'input#id_tipo_pesq_29[name="id_tipo_pesq"]',
  all: 'input[type="checkbox"][name="id_tipo_pesq"]',
  select: 'div.pa.ac > a.button:has-text("Selecionar")',
  refresh: 'a.link:has(i[title="Mostrar Tudo"])'
} as const

export class CpiQueueFilter {
  private applied = new WeakSet<Page>()
  private pending = new WeakMap<Page, Promise<void>>()

  reset(page: Page): void {
    this.applied.delete(page)
  }

  async ensure(page: Page): Promise<void> {
    const pending = this.pending.get(page)
    if (pending) return pending
    const task = this.applyIfNeeded(page)
    this.pending.set(page, task)
    try {
      await task
    } finally {
      this.pending.delete(page)
    }
  }

  private async single(frames: Frame[], selector: string): Promise<Locator> {
    const controls: Locator[] = []
    for (const frame of frames) {
      const locator = frame.locator(selector)
      const count = await locator.count()
      if (count > 1) throw new Error('Controle de filtro CPI duplicado.')
      if (count === 1) controls.push(locator)
    }
    if (controls.length !== 1) throw new Error('Controle de filtro CPI não confirmado.')
    return controls[0]
  }

  private async applyIfNeeded(page: Page): Promise<void> {
    // A retained filter DOM supplies evidence of loss. No timer polls the portal.
    let lost = false
    for (const frame of page.frames()) {
      if ((await frame.locator(CPI_FILTER.target).count()) === 1) {
        lost ||= !(await frame
          .locator(CPI_FILTER.all)
          .evaluateAll((elements) =>
            elements.every((e) => (e as HTMLInputElement).checked === (e.id === 'id_tipo_pesq_29'))
          ))
      }
    }
    if (this.applied.has(page) && !lost) return
    const advanced = await this.single(page.frames(), CPI_FILTER.advanced)
    await advanced.click({ timeout: 10000 })
    // Bounded rendering wait, used only following the explicit filter action.
    let target: Locator | undefined
    for (let attempt = 0; attempt < 20; attempt++) {
      const frames = page.frames().filter((f) => !f.isDetached())
      const matches: Frame[] = []
      for (const frame of frames)
        if ((await frame.locator(CPI_FILTER.target).count()) > 0) matches.push(frame)
      if (matches.length > 1) throw new Error('Filtro CPI em múltiplos frames.')
      if (matches.length === 1) {
        const frame = matches[0]
        target = await this.single([frame], CPI_FILTER.target)
        await frame.locator(CPI_FILTER.all).evaluateAll((elements) => {
          for (const element of elements) {
            const input = element as HTMLInputElement
            const checked = input.id === 'id_tipo_pesq_29'
            if (input.checked === checked) continue
            input.checked = checked
            input.dispatchEvent(new Event('input', { bubbles: true }))
            input.dispatchEvent(new Event('change', { bubbles: true }))
          }
        })
        if (!(await target.isChecked())) throw new Error('Filtro criminal CPI não selecionado.')
        await (await this.single([frame], CPI_FILTER.select)).click({ timeout: 10000 })
        await page.waitForTimeout(700)
        this.applied.add(page)
        return
      }
      await page.waitForTimeout(250)
    }
    throw new Error('Filtro avançado CPI não apareceu no prazo esperado.')
  }

  async refresh(page: Page): Promise<void> {
    await (await this.single(page.frames(), CPI_FILTER.refresh)).click({ timeout: 10000 })
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 })
    await this.ensure(page)
  }
}
