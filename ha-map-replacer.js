// 配置常量 
 const DOMAIN = 'ha_map_replacer'; 
 const DEFAULT_PROXY_URL = 'http://172.22.222.94:8280'; 
 const DEFAULT_MAX_ZOOM = 18; 
 const TILE_SIZE = 256; 
 const AMAP_TILE_PATH = '/amap'; 
  
 let CURRENT_PROXY_URL = DEFAULT_PROXY_URL; 
 let CURRENT_MAX_ZOOM = DEFAULT_MAX_ZOOM; 
 const existsCoordSet = new Set(); 
  
 // 加载配置文件 
 async function loadConfig() { 
     try { 
         const response = await fetch('/hacsfiles/ha-map-replacer/config.json'); 
         if (!response.ok) throw new Error('配置文件加载失败'); 
         const config = await response.json(); 
         CURRENT_PROXY_URL = config.proxy_url || DEFAULT_PROXY_URL; 
         CURRENT_MAX_ZOOM = config.max_zoom || DEFAULT_MAX_ZOOM; 
         console.log(`[${DOMAIN}] 配置加载成功:`, config); 
     } catch (error) { 
         console.warn(`[${DOMAIN}] 配置加载失败，使用默认值:`, error); 
         CURRENT_PROXY_URL = DEFAULT_PROXY_URL; 
         CURRENT_MAX_ZOOM = DEFAULT_MAX_ZOOM; 
     } 
 } 
  
 // 降级算法 
 function downgradeTile(x, y, z, maxZoom) { 
     if (z <= maxZoom) { 
         return { srcX: x, srcY: y, srcZ: z, scale: 1, dx: 0, dy: 0 }; 
     } 
     const scale = 2 ** (z - maxZoom); 
     const srcX = Math.floor(x / scale); 
     const srcY = Math.floor(y / scale); 
     const srcZ = maxZoom; 
     const offsetX = (x % scale) * TILE_SIZE / scale; 
     const offsetY = (y % scale) * TILE_SIZE / scale; 
     return { 
         srcX, srcY, srcZ, scale, 
         dx: -offsetX * scale, dy: -offsetY * scale 
     }; 
 } 
  
 function generateAmapUrl(x, y, z) { 
     return `${CURRENT_PROXY_URL}${AMAP_TILE_PATH}/${z}/${x}/${y}.jpg`; 
 } 
  
 function transformCartoImg(img) { 
     const src = img.src; 
     if (!src || !src.startsWith('https://basemaps.cartocdn.com/')) return; 
  
     const match = src.match(/rastertiles\/voyager\/(\d+)\/(\d+)\/(\d+)(?:@2x)?\.png/); 
     if (!match) return; 
  
     let [_, zStr, xStr, yStr] = match; 
     let z = parseInt(zStr), x = parseInt(xStr), y = parseInt(yStr); 
  
     if (z <= CURRENT_MAX_ZOOM) { 
         img.src = generateAmapUrl(x, y, z); 
         console.log(`[${DOMAIN}] 替换瓦片:`, src, '→', img.src); 
         return; 
     } 
  
     const { srcX, srcY, srcZ, scale, dx, dy } = downgradeTile(x, y, z, CURRENT_MAX_ZOOM); 
     const downgradeKey = `${srcX},${srcY},${srcZ},${z}`; 
     if (existsCoordSet.has(downgradeKey)) { 
         img.src = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="; 
         img.style.display = "none"; 
         return; 
     } 
  
     img["downgradeKey"] = downgradeKey; 
     existsCoordSet.add(downgradeKey); 
     img.src = generateAmapUrl(srcX, srcY, srcZ); 
  
     if (img.style.transform?.includes('translate3d(')) { 
         const match = img.style.transform.match(/translate3d\(([^,]+),\s*([^,]+),\s*([^)]+)\)/); 
         if (match) { 
             const [_, tx, ty] = match; 
             const newTx = parseFloat(tx) + dx; 
             const newTy = parseFloat(ty) + dy; 
             img.style.transform = img.style.transform.replace(/translate3d\([^)]+\)/, `translate3d(${newTx}px, ${newTy}px, 0px)`); 
         } 
     } 
  
     if (!img.style.transform.includes('scale(')) { 
         img.style.transform = (img.style.transform || '') + ` scale(${scale})`; 
     } 
  
     img.style.width = TILE_SIZE + 'px'; 
     img.style.height = TILE_SIZE + 'px'; 
     img.style.transformOrigin = 'top left'; 
  
     console.log(`[${DOMAIN}] 降级瓦片:`, `${z} → ${CURRENT_MAX_ZOOM}, src:`, img.src); 
 } 
  
 function handleAddedNode(node) { 
     if (!(node instanceof Element)) return; 
     if (node.tagName === 'DIV' && node.classList.contains('leaflet-layer')) { 
         const _appendChild = Element.prototype.appendChild; 
         node.appendChild = function (child) { 
             if (child.tagName === 'DIV' && child.classList.contains('leaflet-tile-container')) { 
                 Array.from(child.querySelectorAll('img')).forEach(img => transformCartoImg(img)); 
                 child.appendChild = function (frags) { 
                     if (frags.children) { 
                         Array.from(frags.children).forEach(img => { 
                             if (img.tagName === 'IMG') transformCartoImg(img); 
                         }); 
                     } 
                     return _appendChild.call(this, frags); 
                 }; 
             } 
             return _appendChild.call(this, child); 
         }; 
     } 
 } 
  
 function handleRemovedNode(node) { 
     if (node.tagName === 'IMG' && node["downgradeKey"]) { 
         existsCoordSet.delete(node["downgradeKey"]); 
     } 
 } 
  
 function observeShadowRoots(root) { 
     const queue = [root]; 
     while (queue.length > 0) { 
         const el = queue.shift(); 
         if (el.shadowRoot) { 
             observer.observe(el.shadowRoot, { childList: true, subtree: true }); 
             queue.push(...el.shadowRoot.querySelectorAll('*')); 
         } 
         if (el.children) queue.push(...el.children); 
     } 
 } 
  
 const observer = new MutationObserver(mutations => { 
     for (const mutation of mutations) { 
         mutation.addedNodes.forEach(handleAddedNode); 
         mutation.removedNodes.forEach(handleRemovedNode); 
     } 
 }); 
  
 async function initDomObserver() { 
     await loadConfig(); 
     console.log(`[${DOMAIN}] DOM观察器已启动，使用代理URL: ${CURRENT_PROXY_URL}`); 
     observer.observe(document, { childList: true, subtree: true }); 
     observeShadowRoots(document.body); 
  
     const originalAttachShadow = Element.prototype.attachShadow; 
     Element.prototype.attachShadow = function (init) { 
         const shadow = originalAttachShadow.call(this, init); 
         observer.observe(shadow, { childList: true, subtree: true }); 
         return shadow; 
     }; 
 } 
  
 // 启动 
 initDomObserver();