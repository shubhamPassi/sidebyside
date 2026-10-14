import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}}); const issues=[]; const requests=[];
  page.on('pageerror',e=>issues.push(e.message));
  page.on('request',req=>{if(req.url().startsWith('https://www.youtube.com/embed/'))requests.push({url:req.url(),referrer:req.headers().referer});});
  await page.goto('http://localhost:3001');await page.getByLabel('What should we call you?').fill('Provider check');await page.getByRole('button',{name:'Create a private room'}).click();
  await page.getByLabel('YouTube video URL').fill('https://www.youtube.com/watch?v=M7lc1UVf-VE');await page.getByRole('button',{name:'Load video'}).click();
  await page.waitForTimeout(12000);
  const activate = page.getByRole('button',{name:'Activate & ready'});
  let activated = false;
  if(await activate.count() && await activate.isEnabled()){await activate.click();activated=true;await page.waitForTimeout(2000);const play=page.getByRole('button',{name:'Play together'});if(await play.isEnabled())await play.click();await page.waitForTimeout(5000);}
  await fs.mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/real-youtube.png',fullPage:true});
  const result={date:new Date().toISOString(),apiReady:activated,embedRequests:requests,playerReadiness:await page.locator('.player-readiness').innerText(),timecode:await page.locator('.timecode').innerText(),issues};
  console.log(JSON.stringify(result,null,2));await fs.writeFile('artifacts/provider-smoke.json',JSON.stringify(result,null,2));
}finally{await browser.close();}
