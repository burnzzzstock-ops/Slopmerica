import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const base=process.env.VAULT_URL||'http://127.0.0.1:5176/';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const errors=[];
const page=await browser.newPage({viewport:{width:1750,height:1100},deviceScaleFactor:1});
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
await fs.mkdir('docs/assets',{recursive:true});
try{
  for(const [category,count] of [['commerce',35],['infrastructure',35],['neighborhood',30]]){
    await page.goto(new URL('asset-vault-overview.html?category='+category,base).href);
    await page.waitForSelector('body[data-ready="true"]');
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.overview-card img')).every(i=>i.complete&&i.naturalWidth===512));
    if(await page.locator('.overview-card').count()!==count)throw new Error('Wrong category count '+category);
    await page.screenshot({path:'docs/assets/vault-'+category+'.jpg',fullPage:true,type:'jpeg',quality:85});
  }
  await page.getByRole('button',{name:'All families',exact:true}).click();
  if(await page.locator('.overview-card').count()!==100)throw new Error('All filter failed');
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.overview-card img')).every(i=>i.complete&&i.naturalWidth===512));
  await page.screenshot({path:'docs/assets/vault-overview.jpg',type:'jpeg',quality:88});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'shots/asset-vault/overview-mobile.png',fullPage:false});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile overflow');
  await page.locator('.overview-card').first().click();
  await page.waitForSelector('#viewport[data-loaded]');
  if(!page.url().includes('asset=vlt-'))throw new Error('Family link failed');
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(JSON.stringify({families:100,categoryCounts:[35,35,30],imagesLoaded:true,mobileOverflow:false,familyLink:true,errors:0}));
}finally{await browser.close();}
