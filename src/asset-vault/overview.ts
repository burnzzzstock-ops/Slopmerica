import type { VaultManifest } from './library';
import './catalog.css';
import './overview.css';

document.body.classList.add('overview');
document.querySelector('#app')!.innerHTML=`
<header><div class="seal">DUD</div><div class="department">DEPARTMENT OF<br><strong>UNNECESSARY DEVELOPMENT</strong></div><a class="overview-back" href="./asset-vault.html">Open 3D catalog ↗</a></header>
<section class="intro"><div><p class="eyebrow">100 FAMILIES. 4,000 STRUCTURAL PLANS.</p><h1>The approved<br><em>development atlas.</em></h1></div><div class="lede"><p>Every image is a rendered model from the library. Select a family to inspect its 40 plans in 3D.</p><div id="overview-filters" class="filters"></div><div id="overview-count"></div></div></section>
<div id="overview-grid" class="overview-grid"></div><p class="overview-footer">ORIGINAL SATIRICAL ART / METRES / THREE DETAIL LEVELS / NO GAMEPLAY REGISTRATION</p>`;
async function initialize(){
  const response=await fetch(new URL('./asset-vault/manifest.json',document.baseURI));
  if(!response.ok)throw new Error('Cannot load the asset manifest');
  const manifest=await response.json() as VaultManifest;
  let category=new URLSearchParams(location.search).get('category')??'';
  const categories=['',...new Set(manifest.families.map(f=>f.category))];
  if(!categories.includes(category))category='';
  function render(){
    const families=manifest.families.filter(f=>!category||f.category===category);
    document.querySelector('#overview-count')!.textContent=families.length+' modeled families / '+families.length*40+' assets';
    document.querySelector('#overview-grid')!.replaceChildren(...families.map(f=>{
      const entry=manifest.assets.find(a=>a.family===f.id&&a.variant===0)!;
      const card=document.createElement('a');card.className='overview-card';card.href='./asset-vault.html?asset='+encodeURIComponent(entry.id);
      const img=document.createElement('img');img.src='./asset-vault/thumbnails/'+f.id+'.png';img.alt=f.label+' — representative plan A1-1';img.width=512;img.height=512;
      const label=document.createElement('strong');label.textContent=f.label;
      const description=document.createElement('p');description.textContent=f.satire;
      const tag=document.createElement('small');tag.textContent=f.category.toUpperCase()+' / 40 PLANS';
      card.append(img,tag,label,description);return card;
    }));
    document.querySelectorAll<HTMLButtonElement>('#overview-filters button').forEach(b=>b.classList.toggle('active',b.dataset.category===category));
    const url=new URL(location.href);if(category)url.searchParams.set('category',category);else url.searchParams.delete('category');history.replaceState(null,'',url);
  }
  for(const c of categories){const b=document.createElement('button');b.textContent=c||'All families';b.dataset.category=c;b.onclick=()=>{category=c;render();};document.querySelector('#overview-filters')!.append(b);}
  render();document.body.dataset.ready='true';
}
void initialize().catch(error=>{document.querySelector('#overview-count')!.textContent=String(error);});
