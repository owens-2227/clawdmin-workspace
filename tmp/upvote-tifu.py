import asyncio
from playwright.async_api import async_playwright

async def main():
    cdp_url = 'ws://127.0.0.1:53900/devtools/browser/83576bd8-0947-4222-ad94-8c03564228e4'
    target_url = 'https://www.reddit.com/r/tifu/comments/1s099j8/tifu_by_building_an_app_that_notifies_me_when_my/'

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(cdp_url)

        contexts = browser.contexts
        if contexts:
            pages = contexts[0].pages
            if pages:
                page = pages[0]
                # Close extra tabs
                for extra in pages[1:]:
                    await extra.close()
            else:
                page = await contexts[0].new_page()
        else:
            ctx = await browser.new_context()
            page = await ctx.new_page()

        print('Navigating to target URL...')
        await page.goto(target_url, wait_until='domcontentloaded')
        await page.wait_for_timeout(3000)

        upvote_btn = page.get_by_role('button', name='upvote')
        count = await upvote_btn.count()
        print(f'Upvote button count: {count}')

        if count == 0:
            print('ERROR: Upvote button not found')
            return

        aria_before = await upvote_btn.first.get_attribute('aria-pressed')
        print(f'aria-pressed before: {aria_before}')

        if aria_before == 'true':
            print('ALREADY_UPVOTED: Post was already upvoted')
            return

        print('Clicking upvote button...')
        await upvote_btn.first.click()
        await page.wait_for_timeout(1500)

        aria_after = await upvote_btn.first.get_attribute('aria-pressed')
        print(f'aria-pressed after: {aria_after}')

        if aria_after == 'true':
            print('SUCCESS: Post upvoted successfully')
        else:
            print(f'FAILURE: aria-pressed is still "{aria_after}" after clicking')

asyncio.run(main())
