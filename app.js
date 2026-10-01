import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
var $=function(s){return document.querySelector(s)};
var view=$('#view'), tabsEl=$('#tabs'), statusEl=$('#status'), toastEl=$('#toast');
var POS={PT:'Portero',DF:'Defensa',MC:'Mediocentro',DC:'Delantero'};
var POS_ORDER=['PT','DF','MC','DC'];
var FORMS=['3-4-3','3-5-2','4-3-3','4-4-2','4-5-1','5-3-2','5-4-1'];
var JORNADAS=17;
var TEAMS=['América','Atlante','Atlas','Atlético de San Luis','Cruz Azul','Guadalajara','Juárez','León','Monterrey','Necaxa','Pachuca','Puebla','Pumas UNAM','Querétaro','Santos Laguna','Tigres UANL','Tijuana','Toluca'];
var DEFAULT_CFG={startCash:20,pointValue:0.1,marketSize:12,clauseRaise:0.5,lockDays:7,maxSquad:24,squad:{PT:1,DF:4,MC:4,DC:2},jornada:1,lineupsLocked:false,closed:{},teams:TEAMS,quickSale:0.5};

var sb=null, session=null, me=null;
var S={ready:false,noDb:false,phase:'loading',members:[],uid:null,owner:false,canWrite:true,cfgExists:false,cfg:{},players:{},managers:{},market:{ids:[]},myBids:{},allBids:null,feed:[],profiles:{},loaded:{},photos:{},points:{},results:{}};
var ui={tab:'equipo',admin:'jugadores',pick:null,confirm:null,expand:null,fTeam:'',fPos:'',q:'',pTeam:'',ownedOnly:true,calc:null,calcS:null,jSel:null,busy:false};
var drafts={};

// ---------- utilidades ----------
function h(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function r1(x){return Math.round((Number(x)||0)*10)/10}
function money(x){x=r1(x);return (x<0?'−':'')+'$'+Math.abs(x).toLocaleString('es-MX',{maximumFractionDigits:1})+'M'}
function sg(n){return (n>0?'+':n<0?'−':'')+Math.abs(n)}
function cfg(){var c=Object.assign({},DEFAULT_CFG,S.cfg||{});c.squad=Object.assign({},DEFAULT_CFG.squad,(S.cfg||{}).squad||{});c.closed=c.closed||{};c.teams=(c.teams&&c.teams.length)?c.teams:TEAMS;return c}
function ptsOf(p,j){var d=S.points[j];var v=d&&p&&d[p.id];return typeof v==='number'?v:null}
function totalOf(p){var t=0;if(p)for(var k in S.points){var v=S.points[k][p.id];if(typeof v==='number')t+=v}return t}
function mJ(u,j){var r=S.results[j];var v=r&&r.scores&&r.scores[u];return typeof v==='number'?v:null}
function mTotal(u){var t=0;for(var k in S.results){var v=mJ(u,k);if(v!=null)t+=v}return t}
function mSnap(u,j){var r=S.results[j];return (r&&r.lineups&&r.lineups[u])||null}
function isAdmin(){return S.owner&&!ui.asPlayer}
async function setPts(j,pid,v){if(v==null){await q(sb.from('points').delete().eq('jornada',j).eq('player_id',pid))}else{await q(sb.from('points').upsert({jornada:+j,player_id:pid,pts:v}))}}
function P(id){var p=S.players[id];return p?Object.assign({id:id},p):null}
function mine(uid){var out=[];for(var id in S.players){if(S.players[id].owner===uid)out.push(P(id))}return out}
function formCounts(f){var a=String(f||'4-4-2').split('-').map(Number);return {PT:1,DF:a[0],MC:a[1],DC:a[2]}}
function teamName(uid){var m=S.managers[uid];return m?(m.teamName||'Equipo sin nombre'):'Libre'}
function personName(uid){var p=S.profiles[uid];return (p&&p.name)||''}
function teamValue(uid){return mine(uid).reduce(function(a,p){return a+(Number(p.value)||0)},0)}
function lastClosed(){var c=cfg(),l=0;for(var k in c.closed){if(c.closed[k]&&+k>l)l=+k}return l}
function shuffle(a){for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t}return a}
function byPos(a,b){return POS_ORDER.indexOf(a.pos)-POS_ORDER.indexOf(b.pos)||totalOf(b)-totalOf(a)||(b.value||0)-(a.value||0)}
function when(t){if(!t)return '';var d=Date.now()-t,m=Math.round(d/60000);if(m<1)return 'ahora';if(m<60)return 'hace '+m+' min';var hh=Math.round(m/60);if(hh<24)return 'hace '+hh+' h';return new Date(t).toLocaleDateString('es-MX',{day:'numeric',month:'short'})}
function dv(id,def){return Object.prototype.hasOwnProperty.call(drafts,id)?drafts[id]:def}
function toast(t,bad){toastEl.textContent=t;toastEl.className=bad?'bad':'';toastEl.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(function(){toastEl.hidden=true},4200)}
function normPos(s){s=String(s||'').trim().toUpperCase();if(/^(PT|POR|GK|ARQ|PORTERO)/.test(s))return 'PT';if(/^(DF|DEF|DEFENSA)/.test(s))return 'DF';if(/^(MC|MED|MID|MEDIO|MEDIOCENTRO|CEN)/.test(s))return 'MC';if(/^(DC|DEL|FW|FWD|DELANTERO)/.test(s))return 'DC';return null}
function fold(s){return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim()}

// ---------- reglas de puntuación (mismas que la calculadora) ----------
var R={minutos:{umbral:60,hasta:1,mas:2},gol:{PT:6,DF:6,MC:5,DC:4},asistGol:3,asistSinGol:1,porteriaCero:{PT:4,DF:3,MC:2,DC:1},
  penFallado:-2,penParado:5,penProvocado:2,penCometido:-2,amarilla:-1,dobleAmarilla:-1,roja:-3,
  golesRecibidos:{cada:2,pts:{PT:-2,DF:-2,MC:-1,DC:-1}},paradas:{cada:2,pts:1},tiros:{cada:2,pts:1},regates:{cada:2,pts:1},
  balonesArea:{cada:2,pts:1},recuperados:{cada:5,pts:1},despejes:{cada:3,pts:1},perdidas:{cada:{PT:8,DF:8,MC:10,DC:12},pts:-1}};
var CF=[['minutos','Minutos'],['goles','Goles'],['asistGol','Asist. de gol'],['asistSinGol','Asist. sin gol'],['golesRecibidos','Goles recibidos'],
  ['tiros','Tiros a puerta'],['regates','Regates'],['balonesArea','Balones al área'],['recuperados','Recuperados'],['despejes','Despejes'],
  ['perdidas','Perdidos'],['paradas','Paradas (PT)'],['penFallado','Penalti fallado'],['penParado','Penalti parado (PT)'],
  ['penProvocado','Penalti provocado'],['penCometido','Penalti cometido'],['amarillas','Amarillas'],['dobleAmarilla','Doble amarilla'],['roja','Roja directa']];
function vv(x,p){return typeof x==='object'?x[p]:x}
function calcular(p,s){
  var t=0,m=s.minutos||0;
  if(m>0)t+=m>R.minutos.umbral?R.minutos.mas:R.minutos.hasta;
  t+=(s.goles||0)*R.gol[p]+(s.asistGol||0)*R.asistGol+(s.asistSinGol||0)*R.asistSinGol;
  if(m>R.minutos.umbral&&!(s.golesRecibidos>0))t+=R.porteriaCero[p];
  ['golesRecibidos','tiros','regates','balonesArea','recuperados','despejes','perdidas','paradas'].forEach(function(k){
    if(k==='paradas'&&p!=='PT')return;var n=s[k]||0;if(!n)return;t+=Math.floor(n/vv(R[k].cada,p))*vv(R[k].pts,p)});
  t+=(s.penFallado||0)*R.penFallado+(p==='PT'?(s.penParado||0)*R.penParado:0)+(s.penProvocado||0)*R.penProvocado+(s.penCometido||0)*R.penCometido;
  t+=(s.amarillas||0)*R.amarilla+(s.dobleAmarilla||0)*R.dobleAmarilla+(s.roja||0)*R.roja;
  return t;
}

// ---------- render ----------
var pending=false, raf=0;
function focusInView(){var a=document.activeElement;return a&&view.contains(a)&&/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)}
function render(force){
  if(!force&&focusInView()){pending=true;return}
  pending=false;cancelAnimationFrame(raf);raf=requestAnimationFrame(doRender);
}
view.addEventListener('focusout',function(){setTimeout(function(){if(pending&&!focusInView())render(true)},0)});

function doRender(){
  renderStatus();renderTabs();
  if(S.phase!=='app'){view.innerHTML=vGate();return}
  if(!S.ready){view.innerHTML='<div class="empty">Cargando plantillas, mercado y clasificación…</div>';return}
  var html='';
  if(ui.tab==='equipo')html=vEquipo();
  else if(ui.tab==='mercado')html=vMercado();
  else if(ui.tab==='clasif')html=vClasif();
  else if(ui.tab==='admin'&&isAdmin())html=vAdmin();
  view.innerHTML=html;
}
function renderStatus(){
  var rb=document.getElementById('role');
  if(rb){if(!S.ready||S.phase!=='app'){rb.hidden=true}else{rb.hidden=false;
    rb.innerHTML='<span class="rolechip'+(isAdmin()?' adm':'')+'">'+(isAdmin()?'Administrador':'Jugador')+'</span>'+(S.owner?'<button type="button" class="btn sm" id="roleToggle">'+(ui.asPlayer?'Volver a administrador':'Ver como jugador')+'</button>':'')+'<button type="button" class="btn sm" id="logout">Salir</button>'}}
  if(S.phase!=='app'){statusEl.textContent='';return}
  var c=cfg(),me=S.managers[S.uid];
  var t='Jornada '+c.jornada+' de '+JORNADAS+(c.lineupsLocked?' · alineaciones bloqueadas':'');
  if(me)t+=' · '+money(me.cash)+' en caja';
  statusEl.textContent=t;
}
function renderTabs(){
  var t=[['equipo','Mi equipo'],['mercado','Mercado'],['clasif','Clasificación']];
  if(isAdmin())t.push(['admin','Admin']);
  tabsEl.innerHTML=t.map(function(x){return '<button type="button" role="tab" data-tab="'+x[0]+'" aria-selected="'+(ui.tab===x[0])+'">'+x[1]+'</button>'}).join('');
}
document.addEventListener('click',function(e){if(e.target&&e.target.id==='roleToggle'){ui.asPlayer=!ui.asPlayer;if(!isAdmin()&&ui.tab==='admin')ui.tab='equipo';render(true)}});
tabsEl.addEventListener('click',function(e){var b=e.target.closest('[data-tab]');if(!b)return;ui.tab=b.dataset.tab;ui.pick=null;ui.confirm=null;ui.expand=null;render(true);try{localStorage.setItem('fmx-tab',ui.tab)}catch(_){}});

// ---------- Mi equipo ----------
function vEquipo(){
  var c=cfg(),me=S.managers[S.uid];
  if(!me){
    return '<div class="card stack" style="max-width:560px"><div><h2>Únete a la liga</h2><p class="muted">Ponle nombre a tu equipo. Empiezas con '+money(c.startCash)+' en caja y te tocan '+(c.squad.PT+c.squad.DF+c.squad.MC+c.squad.DC)+' jugadores al azar ('+c.squad.PT+' portero, '+c.squad.DF+' defensas, '+c.squad.MC+' medios y '+c.squad.DC+' delanteros), ya alineados.</p></div>'+
      '<div class="row"><label class="f" style="flex:1 1 220px">Nombre del equipo<input type="text" id="teamName" maxlength="30" value="'+h(dv('teamName',''))+'" placeholder="Ej. Los Tomateros FC"></label>'+
      '<button class="btn pri" data-act="join" style="align-self:end">Entrar a la liga</button></div>'+
      '</div>';
  }
  var my=mine(S.uid).sort(byPos);
  var lc=lastClosed();
  var head='<div class="row" style="justify-content:space-between"><h2 style="margin:0">'+h(me.teamName)+'</h2>'+
    '<button class="btn sm" data-act="rename">Cambiar nombre</button></div>';
  if(ui.expand==='rename')head+='<div class="row" style="margin-top:10px"><input type="text" id="rn" maxlength="30" value="'+h(dv('rn',me.teamName))+'"><button class="btn pri sm" data-act="rename-save">Guardar</button></div>';
  var stats='<div class="stats">'+
    st(money(me.cash),'En caja')+st(money(teamValue(S.uid)),'Valor plantilla')+st(mTotal(S.uid),'Puntos')+st(my.length+'/'+c.maxSquad,'Jugadores')+'</div>';
  if(!my.length)return '<div class="stack">'+head+stats+'<div class="empty">Todavía no tienes jugadores. Puja en el Mercado o pide a Fernando que use "Repartir plantillas" en Admin.</div></div>';

  var f=me.formation||'4-4-2',cnt=formCounts(f);
  var lineup=(me.lineup||[]).filter(function(id){return S.players[id]&&S.players[id].owner===S.uid});
  var locked=c.lineupsLocked;
  var ctr='<div class="row"><label class="f">Formación<select id="formation" data-act="formation"'+(locked?' disabled':'')+'>'+FORMS.map(function(x){return '<option'+(x===f?' selected':'')+'>'+x+'</option>'}).join('')+'</select></label>'+
    '<button class="btn" data-act="autoline" style="align-self:end"'+(locked?' disabled':'')+'>Alineación automática</button>'+
    '<span class="small muted" style="align-self:end;padding-bottom:10px">'+(locked?'Alineaciones bloqueadas: la jornada '+c.jornada+' está en juego.':'Toca un hueco de la cancha para colocar o cambiar a un jugador.')+'</span></div>';
  var rows=['DC','MC','DF','PT'].map(function(pos){
    var inPos=lineup.filter(function(id){return S.players[id].pos===pos});
    var slots='';
    for(var i=0;i<cnt[pos];i++){
      var id=inPos[i],p=id?P(id):null;
      var on=ui.pick&&ui.pick.pos===pos&&ui.pick.i===i;
      if(p){var jp=ptsOf(p,c.jornada),lp=lc?ptsOf(p,lc):null;
        slots+='<button class="slot'+(on?' on':'')+'" data-act="slot" data-pos="'+pos+'" data-i="'+i+'" data-id="'+p.id+'"'+(locked?' disabled':'')+' aria-label="'+h(p.name)+', cambiar"><span class="disc">'+(S.photos[p.id]?av(p,true):h(p.num!=null?p.num:pos))+'</span>'+((jp!=null||lp!=null)?'<span class="pp">'+sg(jp!=null?jp:lp)+'</span>':'')+'<span class="nm">'+h(shortName(p.name))+'</span><span class="tm">'+h(p.team)+'</span></button>';}
      else slots+='<button class="slot emptyslot'+(on?' on':'')+'" data-act="slot" data-pos="'+pos+'" data-i="'+i+'"'+(locked?' disabled':'')+' aria-label="Colocar '+POS[pos]+'"><span class="disc">+</span><span class="nm">'+POS[pos]+'</span></button>';
    }
    return '<div class="line">'+slots+'</div>';
  }).join('');
  var pitch='<div class="pitch"><div class="pitch-in">'+rows+'</div></div>';
  var nIn=lineup.length,need=11;
  var picker='';
  if(ui.pick){
    var cur=ui.pick.id;
    var opts=my.filter(function(p){return p.pos===ui.pick.pos&&lineup.indexOf(p.id)===-1});
    picker='<div class="card"><h3>'+(cur?'Cambiar a '+h(P(cur).name):'Elegir '+POS[ui.pick.pos].toLowerCase())+'</h3>'+
      (opts.length?'<div class="list">'+opts.map(function(p){return '<div class="item">'+av(p)+'<div class="who"><b>'+h(p.name)+'</b><small>'+numTxt(p)+h(p.team)+' · '+totalOf(p)+' pts · '+money(p.value)+'</small></div><button class="btn sm pri" data-act="put" data-id="'+p.id+'">Poner</button></div>'}).join('')+'</div>':'<p class="muted">No tienes más '+POS[ui.pick.pos].toLowerCase()+'s en el banquillo.</p>')+
      '<div class="row" style="margin-top:10px">'+(cur?'<button class="btn sm" data-act="unput">Quitar de la alineación</button>':'')+'<button class="btn sm" data-act="pick-close">Cerrar</button></div></div>';
  }
  var squad='<div><h3>Plantilla</h3><div class="list">'+my.map(function(p){return itemMine(p,lineup,c)}).join('')+'</div></div>';
  return '<div class="stack">'+head+stats+'<div>'+ctr+'</div><div>'+pitch+'<p class="small muted" style="margin:8px 0 0">'+nIn+' de 11 titulares · la etiqueta de cada jugador son sus puntos de la jornada actual o, si aún no hay, de la última cerrada.</p></div>'+picker+squad+'</div>';
}
function st(v,l){return '<div class="stat"><b>'+v+'</b><span>'+l+'</span></div>'}
function av(p,big){var s=S.photos[p.id];var c='av'+(big?' big':'');
  if(typeof s==='string'&&s.indexOf('data:image/')===0)return '<img class="'+c+'" src="'+h(s)+'" alt="">';
  return '<span class="'+c+' ph" aria-hidden="true">'+(p.num!=null&&p.num!==''?h(p.num):p.pos)+'</span>'}
function quick(p){return r1((p.value||0)*cfg().quickSale)}
function askPrice(p){return p.sale&&p.sale.price?p.sale.price:(p.value||0)}
function numTxt(p){return p.num!=null&&p.num!==''?'#'+p.num+' · ':''}
function shortName(n){n=String(n||'');var p=n.split(' ');return p.length>1&&n.length>14?p[0][0]+'. '+p.slice(1).join(' '):n}
function itemMine(p,lineup,c){
  var tit=lineup.indexOf(p.id)!==-1;
  var clause=Math.max(p.clause||0,p.value||0);
  var lockLeft=lockRemaining(p,c);
  var acts='<button class="btn sm" data-act="clause-open" data-id="'+p.id+'">Subir cláusula</button>'+
    (p.sale?'<button class="btn sm" data-act="unlist" data-id="'+p.id+'">Quitar del mercado</button>':'<button class="btn sm" data-act="list-open" data-id="'+p.id+'">Poner en el mercado</button>')+
    (ui.confirm==='sell:'+p.id?'<button class="btn sm danger armed" data-act="sell" data-id="'+p.id+'">Confirmar venta por '+money(quick(p))+'</button><button class="btn sm" data-act="cancel">No</button>':
    '<button class="btn sm danger" data-act="sell-ask" data-id="'+p.id+'">Venta rápida '+money(quick(p))+'</button>');
  var extra='';
  if(ui.expand==='clause:'+p.id){
    var id='cl-'+p.id;
    extra='<div class="row" style="flex-basis:100%"><label class="f">Nueva cláusula ($M)<input type="number" step="0.1" min="'+clause+'" id="'+id+'" value="'+h(dv(id,r1(clause+5)))+'" style="width:120px"></label>'+
      '<span class="small muted" style="align-self:end;padding-bottom:10px">Cuesta el '+Math.round(c.clauseRaise*100)+'% de lo que subas.</span>'+
      '<button class="btn sm pri" data-act="clause-save" data-id="'+p.id+'" style="align-self:end">Aplicar</button><button class="btn sm" data-act="cancel" style="align-self:end">Cancelar</button></div>';
  }
  if(ui.expand==='list:'+p.id){var lid='ls-'+p.id;
    extra+='<div class="row" style="flex-basis:100%"><label class="f">Precio de salida ($M)<input type="number" step="0.1" min="'+(p.value||0)+'" id="'+lid+'" value="'+h(dv(lid,p.value||0))+'" style="width:120px"></label>'+
      '<span class="small muted" style="align-self:end;padding-bottom:10px">Los rivales pujan a ciegas desde este precio. Si al cerrar el mercado hay puja, el jugador se va y cobras la puja más alta.</span>'+
      '<button class="btn sm pri" data-act="list-save" data-id="'+p.id+'" style="align-self:end">Publicar</button><button class="btn sm" data-act="cancel" style="align-self:end">Cancelar</button></div>';}
  return '<div class="item">'+av(p)+'<span class="chip '+p.pos+'">'+p.pos+'</span><div class="who"><b>'+h(p.name)+(tit?' <span class="small muted">· titular</span>':'')+'</b><small>'+numTxt(p)+h(p.team)+(lockLeft>0?' · protegido '+lockLeft+' d':'')+(p.sale?' · <span style="color:var(--warn)">en el mercado por '+money(p.sale.price)+'</span>':'')+'</small></div>'+
    '<div class="fig">'+totalOf(p)+'<small>pts</small></div><div class="fig">'+money(p.value)+'<small>valor</small></div><div class="fig">'+money(clause)+'<small>cláusula</small></div>'+
    '<div class="acts">'+acts+'</div>'+extra+'</div>';
}
function lockRemaining(p,c){if(!p.signedAt)return 0;var ms=c.lockDays*86400000-(Date.now()-p.signedAt);return ms>0?Math.ceil(ms/86400000):0}

// ---------- Mercado ----------
function vMercado(){
  var c=cfg(),me=S.managers[S.uid];
  var ids=(S.market.ids||[]).filter(function(id){return S.players[id]&&!S.players[id].owner});
  var listed=Object.keys(S.players).filter(function(id){var p=S.players[id];return p.owner&&p.sale&&p.sale.price});
  var out='<div class="stack">';
  var head='<div><h2>Mercado</h2><p class="muted" style="margin:0">Pujas a ciegas: nadie ve tu oferta. Cuando Fernando cierra el mercado, cada jugador se va con la puja más alta (en empate gana quien pujó primero). La puja mínima es el valor del jugador, o el precio que pidió su dueño si lo puso a la venta.</p></div>';
  out+=head;
  if(!me){out+='<div class="note">Únete a la liga en "Mi equipo" para poder pujar.</div>'}
  var myOff=S.myBids||{},tot=0;for(var k in myOff){if(ids.indexOf(k)!==-1||listed.indexOf(k)!==-1)tot+=myOff[k].amount||0}
  out+='<h3 style="margin:0">Jugadores libres</h3>';
  if(!ids.length){out+='<div class="empty">No hay mercado de la liga abierto ahora.'+(isAdmin()?' Ábrelo en Admin → Liga.':' Fernando lo abre desde su panel.')+'</div>'}
  else{
    if(me)out+='<p class="small" style="margin:0">Tus pujas suman <b class="num">'+money(tot)+'</b> de <b class="num">'+money(me.cash)+'</b> en caja'+(tot>me.cash?' · <span style="color:var(--bad)">no te alcanza para todas; se adjudican mientras tengas dinero</span>':'')+'.'+(S.market.openedAt?' Abierto '+when(S.market.openedAt)+'.':'')+'</p>';
    out+='<div class="list">'+ids.map(function(id){var p=P(id),b=myOff[id];var did='bid-'+id;
      return '<div class="item">'+av(p)+'<span class="chip '+p.pos+'">'+p.pos+'</span><div class="who"><b>'+h(p.name)+'</b><small>'+numTxt(p)+h(p.team)+' · '+POS[p.pos]+'</small></div>'+
        '<div class="fig">'+totalOf(p)+'<small>pts</small></div><div class="fig">'+money(p.value)+'<small>valor</small></div>'+
        (me?'<div class="acts"><input type="number" step="0.1" min="'+p.value+'" id="'+did+'" value="'+h(dv(did,b?b.amount:p.value))+'" style="width:96px" aria-label="Puja por '+h(p.name)+' en millones">'+
        '<button class="btn sm pri" data-act="bid" data-id="'+id+'">'+(b?'Cambiar puja':'Pujar')+'</button>'+(b?'<button class="btn sm" data-act="unbid" data-id="'+id+'">Retirar</button>':'')+'</div>'+
        (b?'<div class="small" style="flex-basis:100%;color:var(--good)">Tu puja: '+money(b.amount)+'</div>':''):'')+'</div>'}).join('')+'</div>';
  }
  out+='<h3 style="margin:0">En venta por otros equipos</h3>';
  if(!listed.length)out+='<div class="empty">Nadie ha puesto jugadores a la venta. Desde "Mi equipo" puedes poner los tuyos.</div>';
  else out+='<div class="list">'+listed.map(function(id){var p=P(id),b=myOff[id],did='bid-'+id,own=p.owner===S.uid;
    return '<div class="item">'+av(p)+'<span class="chip '+p.pos+'">'+p.pos+'</span><div class="who"><b>'+h(p.name)+'</b><small>'+numTxt(p)+h(p.team)+' · de '+h(teamName(p.owner))+'</small></div>'+
      '<div class="fig">'+totalOf(p)+'<small>pts</small></div><div class="fig">'+money(p.sale.price)+'<small>precio</small></div>'+
      (own?'<div class="acts"><span class="small muted">Es tuyo</span><button class="btn sm" data-act="unlist" data-id="'+id+'">Quitar</button></div>':
       me?'<div class="acts"><input type="number" step="0.1" min="'+p.sale.price+'" id="'+did+'" value="'+h(dv(did,b?b.amount:p.sale.price))+'" style="width:96px" aria-label="Puja por '+h(p.name)+' en millones">'+
      '<button class="btn sm pri" data-act="bid" data-id="'+id+'">'+(b?'Cambiar puja':'Pujar')+'</button>'+(b?'<button class="btn sm" data-act="unbid" data-id="'+id+'">Retirar</button>':'')+'</div>'+
      (b?'<div class="small" style="flex-basis:100%;color:var(--good)">Tu puja: '+money(b.amount)+'</div>':''):'')+'</div>'}).join('')+'</div>';
  // Cláusulas
  var others=Object.keys(S.managers).filter(function(u){return u!==S.uid});
  out+='<div><h2>Cláusulas de rivales</h2><p class="muted" style="margin:0 0 10px">Paga la cláusula y el jugador pasa a tu equipo al momento; el dinero va al dueño. Los fichajes recientes están protegidos '+c.lockDays+' días.</p>';
  if(!others.length)out+='<div class="empty">Aún no hay rivales en la liga.</div>';
  others.forEach(function(u){
    var ps=mine(u).sort(byPos);if(!ps.length)return;
    var open=ui.expand==='riv:'+u;
    out+='<details'+(open?' open':'')+' data-riv="'+u+'"><summary>'+h(teamName(u))+(personName(u)?' <span class="muted small">&nbsp;· '+h(personName(u))+'</span>':'')+'&nbsp;<span class="muted small">· '+ps.length+' jugadores</span></summary><div class="list">'+
      ps.map(function(p){var cl=Math.max(p.clause||0,p.value||0),lk=lockRemaining(p,c);var can=me&&me.cash>=cl&&!lk;
        var btn=!me?'':lk?'<span class="small muted">Protegido '+lk+' d</span>':
          (ui.confirm==='buy:'+p.id?'<button class="btn sm danger armed" data-act="clausulazo" data-id="'+p.id+'">Pagar '+money(cl)+'</button><button class="btn sm" data-act="cancel">No</button>':
          '<button class="btn sm" data-act="buy-ask" data-id="'+p.id+'"'+(can?'':' disabled title="No te alcanza"')+'>Clausulazo</button>');
        return '<div class="item">'+av(p)+'<span class="chip '+p.pos+'">'+p.pos+'</span><div class="who"><b>'+h(p.name)+'</b><small>'+h(p.team)+'</small></div><div class="fig">'+totalOf(p)+'<small>pts</small></div><div class="fig">'+money(cl)+'<small>cláusula</small></div><div class="acts">'+btn+'</div></div>'}).join('')+'</div></details>';
  });
  out+='</div></div>';
  return out;
}

// ---------- Clasificación ----------
function vClasif(){
  var c=cfg(),lc=lastClosed();
  var ms=Object.keys(S.managers).map(function(u){var m=S.managers[u];return {u:u,m:m,val:teamValue(u),last:lc?mJ(u,lc):null,tot:mTotal(u)}})
    .sort(function(a,b){return b.tot-a.tot||b.val-a.val});
  var out='<div class="stack"><div><h2>Clasificación</h2>';
  if(!ms.length)out+='<div class="empty">Nadie se ha unido todavía. Cada amigo entra desde "Mi equipo".</div>';
  else out+='<div class="scroll"><table><thead><tr><th>#</th><th>Equipo</th><th class="n">Puntos</th><th class="n">'+(lc?'J'+lc:'Última')+'</th><th class="n">Valor</th></tr></thead><tbody>'+
    ms.map(function(x,i){var open=ui.expand==='cl:'+x.u;
      var r='<tr class="click" data-act="cl-toggle" data-u="'+x.u+'"><td class="rank">'+(i+1)+'</td><td><b>'+h(x.m.teamName)+'</b>'+(x.u===S.uid?' <span class="small muted">(tú)</span>':'')+(personName(x.u)?'<div class="small muted">'+h(personName(x.u))+'</div>':'')+'</td>'+
        '<td class="n"><b>'+x.tot+'</b></td><td class="n">'+(x.last!=null?x.last:'—')+'</td><td class="n">'+money(x.val)+'</td></tr>';
      if(open){var snap=lc&&mSnap(x.u,lc);var ps=mine(x.u).sort(byPos);
        r+='<tr><td></td><td colspan="4"><div class="small">'+(ps.length?ps.map(function(p){var t=snap&&snap.indexOf(p.id)!==-1;return '<span class="chip '+p.pos+'">'+p.pos+'</span> '+h(p.name)+(t?' <b>('+(ptsOf(p,lc)!=null?sg(ptsOf(p,lc)):'0')+' en J'+lc+')</b>':'')}).join('<br>'):'Sin jugadores')+'</div></td></tr>'}
      return r}).join('')+'</tbody></table></div><p class="small muted">Toca un equipo para ver su plantilla. Entre paréntesis, lo que sumó cada titular en la última jornada cerrada.</p>';
  out+='</div><div class="grid2"><div><h3>Movimientos</h3>'+(S.feed.length?'<ul class="feed">'+S.feed.slice(0,25).map(function(f){return '<li><time>'+when(f.t)+'</time>'+h(f.text)+'</li>'}).join('')+'</ul>':'<div class="empty">Aquí aparecerán fichajes, ventas y clausulazos.</div>')+'</div>'+
    '<div><h3>Cómo se juega</h3><div class="small"><p>Al unirte te tocan 11 jugadores al azar, ya alineados en 4-4-2. Alinea a tus 11 titulares antes de que Fernando bloquee la jornada. Solo suman los titulares, con la tabla de LaLiga Fantasy sin nota DAZN.</p><p>Cada punto de la jornada te da '+money(c.pointValue)+' extra en caja. Plantilla máxima: '+c.maxSquad+' jugadores.</p><p>Puedes hacer una venta rápida al instante por el '+Math.round(c.quickSale*100)+'% del valor, poner a un jugador en el mercado con tu precio para que los demás pujen, pujar por libres o pagar la cláusula de un rival. Subir tu cláusula cuesta el '+Math.round(c.clauseRaise*100)+'% del aumento.</p></div></div></div></div>';
  return out;
}

// ---------- Admin ----------
function vAdmin(){
  var np=S.members.filter(function(m){return m.status==='pending'}).length;var sub=[['solicitudes','Solicitudes'+(np?' ('+np+')':'')],['jugadores','Jugadores'],['puntos','Puntos de jornada'],['liga','Liga y mercado']];
  var out='<div class="subtabs">'+sub.map(function(s){return '<button class="btn sm'+(ui.admin===s[0]?' pri':'')+'" data-act="admin-sub" data-s="'+s[0]+'">'+s[1]+'</button>'}).join('')+'</div>';
  if(ui.admin==='jugadores')out+=aJugadores();
  else if(ui.admin==='puntos')out+=aPuntos();
  else if(ui.admin==='solicitudes')out+=aSolicitudes();
  else out+=aLiga();
  return out;
}
function teamOpts(sel,withAll){var c=cfg();var t=c.teams.slice();if(sel&&t.indexOf(sel)===-1)t.push(sel);return (withAll?'<option value="">Todos los equipos</option>':'')+t.map(function(x){return '<option'+(x===sel?' selected':'')+'>'+h(x)+'</option>'}).join('')}
function posOpts(sel,withAll){return (withAll?'<option value="">Todas</option>':'')+POS_ORDER.map(function(p){return '<option value="'+p+'"'+(p===sel?' selected':'')+'>'+POS[p]+'</option>'}).join('')}
function filtered(team,pos,q,ownedOnly){var fq=fold(q);var out=[];for(var id in S.players){var p=S.players[id];
  if(team&&p.team!==team)continue;if(pos&&p.pos!==pos)continue;if(ownedOnly&&!p.owner)continue;if(fq&&fold(p.name).indexOf(fq)===-1)continue;out.push(P(id))}
  return out.sort(function(a,b){return (a.team||'').localeCompare(b.team||'')||byPos(a,b)})}
function aJugadores(){
  var all=Object.keys(S.players).length;
  var list=filtered(ui.fTeam,ui.fPos,ui.q,false);
  var shown=list.slice(0,150);
  var mOpts=function(sel){return '<option value="">Libre</option>'+Object.keys(S.managers).map(function(u){return '<option value="'+u+'"'+(u===sel?' selected':'')+'>'+h(teamName(u))+'</option>'}).join('')};
  var out='<div class="stack"><div class="grid2"><div class="card"><h3>Pegar lista de jugadores</h3><p class="small muted" style="margin-top:0">Una línea por jugador: <b>Nombre, Equipo, Posición, Valor</b>. Posición: PT, DF, MC o DC (también POR, DEF, MED, DEL). Valor en millones. Si el jugador ya existe en ese equipo, se actualizan su posición y valor.</p>'+
    '<textarea id="imp" placeholder="Paulinho, Toluca, DC, 12&#10;Alexis Vega, Toluca, MC, 9.5&#10;Luis Malagón, América, PT, 6">'+h(dv('imp',''))+'</textarea><div class="row" style="margin-top:8px"><button class="btn pri" data-act="import">Cargar lista</button></div></div>'+
    '<div class="card"><h3>Agregar un jugador</h3><div class="stack" style="gap:10px"><label class="f">Nombre<input type="text" id="np-name" value="'+h(dv('np-name',''))+'"></label>'+
    '<div class="row"><label class="f">Equipo<select id="np-team">'+teamOpts(dv('np-team',ui.fTeam||cfg().teams[0]))+'</select></label><label class="f">Posición<select id="np-pos">'+posOpts(dv('np-pos','MC'))+'</select></label><label class="f">Valor ($M)<input type="number" step="0.1" min="0" id="np-val" value="'+h(dv('np-val','5'))+'" style="width:100px"></label></div>'+
    '<div><button class="btn pri" data-act="add-player">Agregar</button></div></div></div>'+
    '<div class="card"><h3>Fotos en lote</h3><p class="small muted" style="margin-top:0">Nombra cada imagen como el jugador, por ejemplo <b>Alexis Vega.jpg</b>. Si eliges un equipo en el filtro de abajo, solo se buscan coincidencias en ese equipo (útil para nombres repetidos). Las fotos se recortan en cuadrado y se guardan pequeñas. Llevas '+Object.keys(S.photos).length+' de '+Object.keys(S.players).length+'.</p>'+
    '<label class="btn pri up">Elegir fotos<input type="file" accept="image/*" multiple class="vh" id="bulkph" data-bulk="1"></label></div></div>';
  out+='<div><h3>'+all+' jugadores cargados</h3><div class="row" style="margin-bottom:10px"><select id="af-team" data-act="filter">'+teamOpts(ui.fTeam,true)+'</select><select id="af-pos" data-act="filter">'+posOpts(ui.fPos,true)+'</select><input type="text" id="af-q" placeholder="Buscar nombre" value="'+h(ui.q)+'"><button class="btn sm" data-act="search">Buscar</button></div>';
  if(!all)out+='<div class="empty">No hay jugadores. Pega la lista de un equipo arriba para empezar.</div>';
  else out+='<div class="scroll"><table class="admintbl"><thead><tr><th>Foto</th><th>Nombre</th><th>Equipo</th><th>Pos</th><th>Valor</th><th>Dueño</th><th class="n">Pts</th><th></th></tr></thead><tbody>'+
    shown.map(function(p){return '<tr><td><div class="row" style="gap:6px;flex-wrap:nowrap">'+av(p)+'<label class="btn sm up">'+(S.photos[p.id]?'Cambiar':'Subir')+'<input type="file" accept="image/*" class="vh" id="ph-'+p.id+'" data-photo="'+p.id+'"></label>'+(S.photos[p.id]?'<button class="btn sm" data-act="photo-del" data-id="'+p.id+'" aria-label="Quitar foto de '+h(p.name)+'">×</button>':'')+'</div></td><td><input class="w-name" type="text" id="e-name-'+p.id+'" data-f="name" data-id="'+p.id+'" value="'+h(p.name)+'"></td>'+
      '<td><select id="e-team-'+p.id+'" data-f="team" data-id="'+p.id+'">'+teamOpts(p.team)+'</select></td>'+
      '<td><select id="e-pos-'+p.id+'" data-f="pos" data-id="'+p.id+'">'+POS_ORDER.map(function(x){return '<option'+(x===p.pos?' selected':'')+'>'+x+'</option>'}).join('')+'</select></td>'+
      '<td><input class="w-val" type="number" step="0.1" min="0" id="e-val-'+p.id+'" data-f="value" data-id="'+p.id+'" value="'+(p.value||0)+'"></td>'+
      '<td><select id="e-own-'+p.id+'" data-f="owner" data-id="'+p.id+'">'+mOpts(p.owner||'')+'</select></td>'+
      '<td class="n">'+totalOf(p)+'</td><td>'+(ui.confirm==='del:'+p.id?'<button class="btn sm danger armed" data-act="del" data-id="'+p.id+'">Borrar</button>':'<button class="btn sm danger" data-act="del-ask" data-id="'+p.id+'" aria-label="Borrar '+h(p.name)+'">×</button>')+'</td></tr>'}).join('')+
    '</tbody></table></div>'+(list.length>shown.length?'<p class="small muted">Mostrando 150 de '+list.length+'. Filtra por equipo para ver el resto.</p>':'')+'<p class="small muted">Los cambios se guardan al salir de cada campo.</p>';
  return out+'</div></div>';
}
function aPuntos(){
  var c=cfg(),j=ui.jSel||c.jornada;
  var list=filtered(ui.pTeam,'','',ui.ownedOnly);
  var closed=c.closed[j];
  var out='<div class="stack"><div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Jornada '+j+(closed?' · cerrada':'')+'</h3><div class="row">'+
    '<button class="btn" data-act="lock">'+(c.lineupsLocked?'Desbloquear alineaciones':'Bloquear alineaciones')+'</button>'+
    (ui.confirm==='close'?'<button class="btn danger armed" data-act="close-j">'+(closed?'Sí, recalcular J'+j:'Sí, cerrar J'+j)+'</button><button class="btn" data-act="cancel">No</button>':'<button class="btn pri" data-act="close-ask">'+(closed?'Recalcular jornada '+j:'Cerrar jornada '+j)+'</button>')+'</div></div>'+
    '<p class="small muted" style="margin:8px 0 0">1. Bloquea las alineaciones cuando empiece la jornada. 2. Captura los puntos de cada jugador. 3. Cierra la jornada: suma los puntos de los 11 titulares de cada equipo, paga '+money(c.pointValue)+' por punto y pasa a la siguiente. Recalcular corrige totales y dinero si cambias un punto después.</p></div>';
  out+='<div class="row"><label class="f">Jornada<select id="pj" data-act="pj">'+Array.from({length:JORNADAS},function(_,i){return '<option value="'+(i+1)+'"'+(i+1===j?' selected':'')+'>'+(i+1)+(c.closed[i+1]?' ✓':'')+'</option>'}).join('')+'</select></label>'+
    '<label class="f">Equipo<select id="pt-team" data-act="pteam">'+teamOpts(ui.pTeam,true)+'</select></label>'+
    '<label class="row small" style="align-self:end;min-height:44px"><input type="checkbox" id="pown" data-act="pown"'+(ui.ownedOnly?' checked':'')+'> Solo jugadores con dueño</label></div>';
  if(!list.length)out+='<div class="empty">'+(ui.ownedOnly?'Ningún jugador tiene dueño todavía.':'No hay jugadores con este filtro.')+'</div>';
  else out+='<div class="list">'+list.map(function(p){var id='pt-'+p.id,v=ptsOf(p,j);
    var row='<div class="item">'+av(p)+'<span class="chip '+p.pos+'">'+p.pos+'</span><div class="who"><b>'+h(p.name)+'</b><small>'+h(p.team)+' · '+h(p.owner?teamName(p.owner):'Libre')+'</small></div>'+
      '<input class="ptin" type="number" step="1" id="'+id+'" data-pts="'+p.id+'" value="'+(v==null?'':v)+'" placeholder="—" aria-label="Puntos de '+h(p.name)+' en la jornada '+j+'">'+
      '<button class="btn sm" data-act="calc" data-id="'+p.id+'">'+(ui.calc===p.id?'Cerrar':'Por estadísticas')+'</button></div>';
    if(ui.calc===p.id){row+='<div class="calc" id="calcbox">'+CF.map(function(f){if((f[0]==='paradas'||f[0]==='penParado')&&p.pos!=='PT')return '';return '<label>'+f[1]+'<input type="number" min="0" step="1" data-cs="'+f[0]+'" id="cs-'+f[0]+'" value="'+(ui.calcS[f[0]]||0)+'"></label>'}).join('')+
      '<div style="grid-column:1/-1" class="row"><b>Total: <span id="calcTotal">'+calcular(p.pos,ui.calcS)+'</span> pts</b><button class="btn sm pri" data-act="calc-use" data-id="'+p.id+'">Guardar estos puntos</button></div></div>'}
    return row}).join('')+'</div>';
  return out+'</div>';
}
function aLiga(){
  var c=cfg(),mk=(S.market.ids||[]).length,nl=Object.keys(S.players).filter(function(id){var p=S.players[id];return p.owner&&p.sale&&p.sale.price}).length;
  var nb=S.allBids?Object.keys(S.allBids).reduce(function(a,u){return a+Object.keys(S.allBids[u]||{}).length},0):0;
  var num=function(id,label,val,step){return '<label class="f">'+label+'<input type="number" step="'+(step||'1')+'" min="0" id="'+id+'" value="'+h(dv(id,val))+'" style="width:110px"></label>'};
  var seedCard='<div class="card"><h3>Datos iniciales</h3><p class="small muted" style="margin-top:0">'+(Object.keys(S.players).length?'Hay '+Object.keys(S.players).length+' jugadores y '+Object.keys(S.photos).length+' fotos cargados. Volver a importar actualiza nombres, equipos, posiciones, valores y fotos de la lista original sin tocar dueños.':'La base de datos está vacía. Importa los jugadores de la Liga MX (con valores y fotos) para empezar.')+'</p><button class="btn'+(Object.keys(S.players).length?'':' pri')+'" data-act="seed">Importar jugadores y fotos</button></div>';
  var out='<div class="stack">'+seedCard+'<div class="card"><h3>Mercado</h3><p class="small muted" style="margin-top:0">'+(mk?'Hay '+mk+' jugadores libres en el mercado':'No hay mercado de la liga abierto')+', '+nl+' jugadores puestos a la venta por sus dueños y '+nb+' pujas recibidas. Al cerrar, cada jugador se adjudica a la puja más alta que el pujador pueda pagar; en las ventas entre equipos el dinero va al dueño.</p><div class="row">'+
    ((mk||nl)?'<button class="btn pri" data-act="mk-close-open">Cerrar, adjudicar y abrir otro</button><button class="btn" data-act="mk-close">Solo cerrar y adjudicar</button>':'<button class="btn pri" data-act="mk-open">Abrir mercado con '+c.marketSize+' jugadores libres</button>')+'</div></div>';
  var noSquad=Object.keys(S.managers).filter(function(u){return !mine(u).length});
  out+='<div class="card"><h3>Reparto inicial</h3><p class="small muted" style="margin-top:0">Cada amigo recibe su plantilla al azar ('+c.squad.PT+' PT, '+c.squad.DF+' DF, '+c.squad.MC+' MC, '+c.squad.DC+' DC) en cuanto se une. Usa este botón solo si alguien quedó sin jugadores. '+(noSquad.length?noSquad.length+' participante(s) sin plantilla.':'Todos tienen plantilla.')+'</p>'+
    '<button class="btn pri" data-act="deal"'+(noSquad.length?'':' disabled')+'>Repartir plantillas</button></div>';
  out+='<div class="card"><h3>Participantes</h3>'+(Object.keys(S.managers).length?'<div class="list">'+Object.keys(S.managers).map(function(u){var m=S.managers[u];
    return '<div class="item"><div class="who"><b>'+h(m.teamName)+'</b><small>'+h(personName(u)||'—')+' · '+mine(u).length+' jugadores</small></div><div class="fig">'+money(m.cash)+'<small>caja</small></div>'+
      '<div class="acts"><input type="number" step="0.1" id="cash-'+u+'" value="'+h(dv('cash-'+u,r1(m.cash)))+'" style="width:96px" aria-label="Caja de '+h(m.teamName)+'"><button class="btn sm" data-act="cash" data-u="'+u+'">Fijar caja</button>'+
      (ui.confirm==='kick:'+u?'<button class="btn sm danger armed" data-act="kick" data-u="'+u+'">Sí, sacar</button><button class="btn sm" data-act="cancel">No</button>':'<button class="btn sm danger" data-act="kick-ask" data-u="'+u+'">Sacar</button>')+'</div></div>'}).join('')+'</div>':'<p class="muted">Nadie se ha unido. Comparte la página y que cada quien entre desde "Mi equipo".</p>')+'</div>';
  out+='<div class="card"><h3>Reglas de la liga</h3><div class="row">'+num('c-start','Caja inicial ($M)',c.startCash,'0.1')+num('c-pv','$M por punto',c.pointValue,'0.01')+num('c-mk','Jugadores en mercado',c.marketSize)+num('c-max','Plantilla máxima',c.maxSquad)+num('c-lock','Días de protección',c.lockDays)+num('c-cr','Costo subir cláusula (0–1)',c.clauseRaise,'0.05')+num('c-qs','Venta rápida (fracción del valor)',c.quickSale,'0.05')+'</div>'+
    '<p class="small muted">Plantilla inicial por posición</p><div class="row">'+num('c-sPT','PT',c.squad.PT)+num('c-sDF','DF',c.squad.DF)+num('c-sMC','MC',c.squad.MC)+num('c-sDC','DC',c.squad.DC)+num('c-j','Jornada actual',c.jornada)+'</div>'+
    '<label class="f" style="margin-top:12px">Equipos de la liga (uno por línea)<textarea id="c-teams" style="min-height:160px">'+h(dv('c-teams',c.teams.join('\n')))+'</textarea></label>'+
    '<div class="row" style="margin-top:10px"><button class="btn pri" data-act="cfg-save">Guardar reglas</button></div></div>';
  return out+'</div>';
}


// ---------- pantallas de acceso ----------
function vGate(){
  if(S.phase==='noconfig')return '<div class="card stack" style="max-width:560px"><h2>Falta configurar</h2><p>Abre <b>config.js</b> y pega la URL y la clave pública (anon key) de tu proyecto de Supabase. Las instrucciones están en LEEME.md.</p></div>';
  if(S.phase==='login')return '<div class="card stack" style="max-width:520px"><div><h2>Entra a la liga</h2><p class="muted">Inicia sesión con tu cuenta de Google. La primera vez, Fernando tiene que aprobar tu acceso.</p></div><div><button class="btn pri" data-gate="google">Entrar con Google</button></div></div>';
  if(S.phase==='pending')return '<div class="card stack" style="max-width:520px"><h2>Solicitud enviada</h2><p>Entraste como <b>'+h(me&&me.email||'')+'</b>. Fernando tiene que aprobar tu acceso desde su panel. Esta pantalla se actualiza sola cuando te apruebe.</p><div><button class="btn" data-gate="logout">Salir</button></div></div>';
  if(S.phase==='rejected')return '<div class="card stack" style="max-width:520px"><h2>Sin acceso</h2><p>Tu cuenta <b>'+h(me&&me.email||'')+'</b> no tiene acceso a esta liga.</p><div><button class="btn" data-gate="logout">Salir</button></div></div>';
  if(S.phase==='error')return '<div class="note bad">'+h(S.err||'No se pudo conectar.')+'</div>';
  return '<div class="empty">Conectando con la liga…</div>';
}
function aSolicitudes(){
  var pend=S.members.filter(function(m){return m.status==='pending'}),ok=S.members.filter(function(m){return m.status==='approved'});
  var row=function(m,btns){return '<div class="item">'+(m.avatar?'<img class="av" src="'+h(m.avatar)+'" alt="">':'<span class="av ph">'+h((m.name||m.email||'?')[0])+'</span>')+'<div class="who"><b>'+h(m.name||'Sin nombre')+(m.is_admin?' <span class="small muted">· administrador</span>':'')+'</b><small>'+h(m.email||'')+'</small></div><div class="acts">'+btns+'</div></div>'};
  return '<div class="stack"><div><h3>Por aprobar</h3>'+(pend.length?'<div class="list">'+pend.map(function(m){return row(m,'<button class="btn sm pri" data-act="approve" data-u="'+m.user_id+'">Aprobar</button><button class="btn sm danger" data-act="reject" data-u="'+m.user_id+'">Rechazar</button>')}).join('')+'</div>':'<div class="empty">No hay solicitudes. Cuando un amigo entre con Google aparecerá aquí.</div>')+'</div>'+
    '<div><h3>Con acceso</h3><div class="list">'+ok.map(function(m){return row(m,m.is_admin?'':(ui.confirm==='revoke:'+m.user_id?'<button class="btn sm danger armed" data-act="reject" data-u="'+m.user_id+'">Sí, quitar acceso</button><button class="btn sm" data-act="cancel">No</button>':'<button class="btn sm danger" data-act="revoke-ask" data-u="'+m.user_id+'">Quitar acceso</button>'))}).join('')+'</div></div></div>';
}

// ---------- acciones ----------
async function q(p){var r=await p;if(r.error)throw r.error;return r.data}
function rpc(name,args){return q(sb.rpc(name,args||{}))}
function busyWrap(fn){return function(){if(ui.busy)return;ui.busy=true;var a=arguments;return Promise.resolve().then(function(){return fn.apply(null,a)}).catch(function(e){console.error(e);toast((e&&e.message)?e.message:'No se pudo guardar. Revisa tu conexión.',true)}).then(function(){ui.busy=false;reloadAll().then(function(){render()})})}}
function val(id){var el=document.getElementById(id);return el?el.value:''}
function bestLineup(uid,form){var cnt=formCounts(form),my=mine(uid).sort(byPos),out=[];POS_ORDER.forEach(function(p){my.filter(function(x){return x.pos===p}).slice(0,cnt[p]).forEach(function(x){out.push(x.id)})});return out}
function clearDrafts(prefix){Object.keys(drafts).forEach(function(k){if(k.indexOf(prefix)===0)delete drafts[k]})}
function myLineup(){var m=S.managers[S.uid];return (m.lineup||[]).filter(function(id){return S.players[id]&&S.players[id].owner===S.uid})}
async function saveCfg(patch){var c=Object.assign({},S.cfg||{},patch);await q(sb.from('config').update({data:c}).eq('id',1))}
function newId(){return 'u'+Date.now().toString(36)+Math.random().toString(36).slice(2,6)}

var A={
  join:async function(){var n=val('teamName').trim();if(!n){toast('Escribe un nombre para tu equipo.',true);return}
    toast('Creando tu equipo y sorteando jugadores…');var got=await rpc('join_league',{p_team:n});delete drafts.teamName;
    toast('¡Listo! Te tocaron '+got+' jugadores y ya están alineados.')},
  rename:function(){ui.expand=ui.expand==='rename'?null:'rename'},
  'rename-save':async function(){var n=val('rn').trim();if(!n)return;await rpc('rename_team',{p_name:n});delete drafts.rn;ui.expand=null;toast('Nombre actualizado.')},
  slot:function(b){ui.pick={pos:b.dataset.pos,i:+b.dataset.i,id:b.dataset.id||null}},
  'pick-close':function(){ui.pick=null},
  put:async function(b){var l=myLineup();
    if(ui.pick.id){var k=l.indexOf(ui.pick.id);if(k!==-1)l[k]=b.dataset.id;else l.push(b.dataset.id)}else l.push(b.dataset.id);
    ui.pick=null;await rpc('set_lineup',{p_formation:S.managers[S.uid].formation||'4-4-2',p_lineup:l})},
  unput:async function(){var l=myLineup().filter(function(id){return id!==ui.pick.id});ui.pick=null;await rpc('set_lineup',{p_formation:S.managers[S.uid].formation||'4-4-2',p_lineup:l})},
  autoline:async function(){var f=S.managers[S.uid].formation||'4-4-2';await rpc('set_lineup',{p_formation:f,p_lineup:bestLineup(S.uid,f)});toast('Alineación armada con tus jugadores con más puntos.')},
  'clause-open':function(b){ui.expand='clause:'+b.dataset.id},
  'clause-save':async function(b){var id=b.dataset.id,p=P(id);var nv=r1(parseFloat(val('cl-'+id)));var cost=await rpc('raise_clause',{p_id:id,p_new:nv});clearDrafts('cl-');ui.expand=null;toast('Cláusula de '+p.name+' en '+money(nv)+'. Pagaste '+money(cost)+'.')},
  'sell-ask':function(b){ui.confirm='sell:'+b.dataset.id},
  cancel:function(){ui.confirm=null;ui.expand=null},
  sell:async function(b){var p=P(b.dataset.id);var qv=await rpc('quick_sell',{p_id:b.dataset.id});ui.confirm=null;toast('Vendiste a '+p.name+' por '+money(qv)+'.')},
  'list-open':function(b){ui.expand='list:'+b.dataset.id},
  'list-save':async function(b){var id=b.dataset.id,p=P(id);var pr=r1(parseFloat(val('ls-'+id)));await rpc('list_player',{p_id:id,p_price:pr});clearDrafts('ls-');ui.expand=null;toast(p.name+' está en el mercado por '+money(pr)+'.')},
  unlist:async function(b){var p=P(b.dataset.id);await rpc('unlist_player',{p_id:b.dataset.id});toast(p.name+' salió del mercado.')},
  bid:async function(b){var id=b.dataset.id,p=P(id);var amt=r1(parseFloat(val('bid-'+id)));await rpc('place_bid',{p_id:id,p_amount:amt});delete drafts['bid-'+id];toast('Puja de '+money(amt)+' por '+p.name+' guardada.')},
  unbid:async function(b){await rpc('remove_bid',{p_id:b.dataset.id});delete drafts['bid-'+b.dataset.id];toast('Puja retirada.')},
  'buy-ask':function(b){ui.confirm='buy:'+b.dataset.id},
  clausulazo:async function(b){var p=P(b.dataset.id);var cl=await rpc('pay_clause',{p_id:b.dataset.id});ui.confirm=null;toast('¡Clausulazo! '+p.name+' ya es tuyo por '+money(cl)+'.')},
  'cl-toggle':function(b){ui.expand=ui.expand==='cl:'+b.dataset.u?null:'cl:'+b.dataset.u},
  'admin-sub':function(b){ui.admin=b.dataset.s;ui.confirm=null;ui.calc=null;if(ui.admin==='solicitudes')reload('members').then(function(){render()})},
  search:function(){ui.q=val('af-q')},
  approve:async function(b){await q(sb.from('members').update({status:'approved'}).eq('user_id',b.dataset.u));toast('Acceso aprobado.')},
  'revoke-ask':function(b){ui.confirm='revoke:'+b.dataset.u},
  reject:async function(b){await q(sb.from('members').update({status:'rejected'}).eq('user_id',b.dataset.u));ui.confirm=null;toast('Acceso quitado.')},
  seed:async function(){
    toast('Descargando jugadores…');var P1=await (await fetch('seed/players.json',{cache:'no-store'})).json();
    var rows=P1.map(function(p){var ex=S.players[p.id];return {id:p.id,name:p.name,team:p.team,pos:p.pos,num:p.num,value:p.value,owner:ex?ex.owner:null,clause:ex?ex.clause:null,signed_at:ex?ex.signedAt:null}});
    for(var i=0;i<rows.length;i+=200){await q(sb.from('players').upsert(rows.slice(i,i+200)));toast('Jugadores '+Math.min(i+200,rows.length)+' de '+rows.length)}
    toast('Descargando fotos…');var PH=await (await fetch('seed/photos.json',{cache:'no-store'})).json();var ids=Object.keys(PH);
    for(var k=0;k<ids.length;k+=40){await q(sb.from('photos').upsert(ids.slice(k,k+40).map(function(id){return {id:id,src:PH[id]}})));toast('Fotos '+Math.min(k+40,ids.length)+' de '+ids.length)}
    toast('Listo: '+rows.length+' jugadores y '+ids.length+' fotos.')},
  import:async function(){var txt=val('imp');var lines=txt.split(/\r?\n/).map(function(l){return l.trim()}).filter(Boolean);var ok=0,upd=0,bad=[];
    var idx={};for(var id in S.players){idx[fold(S.players[id].name)+'|'+fold(S.players[id].team)]=id}
    var teams=cfg().teams;
    for(var i=0;i<lines.length;i++){var parts=lines[i].split(/\t|;|,/).map(function(s){return s.trim()});
      if(parts.length<3){bad.push(lines[i]);continue}
      var name=parts[0],team=parts[1],pos=normPos(parts[2]),v=parts[3]!=null?parseFloat(String(parts[3]).replace(/[^0-9.]/g,'')):5;
      var tm=teams.filter(function(t){return fold(t)===fold(team)})[0]||team;
      if(!name||!pos||isNaN(v)){bad.push(lines[i]);continue}
      var ex=idx[fold(name)+'|'+fold(tm)];
      if(ex){await q(sb.from('players').update({pos:pos,value:r1(v)}).eq('id',ex));upd++}
      else{var nid=newId();await q(sb.from('players').insert({id:nid,name:name,team:tm,pos:pos,value:r1(v)}));idx[fold(name)+'|'+fold(tm)]=nid;ok++}
    }
    if(!bad.length)delete drafts.imp;else drafts.imp=bad.join('\n');
    toast(ok+' nuevos, '+upd+' actualizados'+(bad.length?'. '+bad.length+' líneas no se entendieron y quedaron en el cuadro.':'.'),bad.length>0)},
  'add-player':async function(){var name=val('np-name').trim(),v=parseFloat(val('np-val'));if(!name){toast('Escribe el nombre.',true);return}
    await q(sb.from('players').insert({id:newId(),name:name,team:val('np-team'),pos:val('np-pos'),value:r1(isNaN(v)?5:v)}));delete drafts['np-name'];toast(name+' agregado.')},
  'del-ask':function(b){ui.confirm='del:'+b.dataset.id},
  'photo-del':async function(b){await q(sb.from('photos').delete().eq('id',b.dataset.id));toast('Foto quitada.')},
  del:async function(b){var id=b.dataset.id;await rpc('admin_set_owner',{p_id:id,p_user:null});await q(sb.from('players').delete().eq('id',id));ui.confirm=null;toast('Jugador borrado.')},
  calc:function(b){if(ui.calc===b.dataset.id){ui.calc=null;return}ui.calc=b.dataset.id;ui.calcS={}},
  'calc-use':async function(b){var p=P(b.dataset.id),j=ui.jSel||cfg().jornada;var t=calcular(p.pos,ui.calcS);await setPts(j,p.id,t);ui.calc=null;toast(p.name+': '+t+' pts en la jornada '+j+'.')},
  lock:async function(){var c=cfg();await saveCfg({lineupsLocked:!c.lineupsLocked});toast(c.lineupsLocked?'Alineaciones desbloqueadas.':'Alineaciones bloqueadas.')},
  'close-ask':function(){ui.confirm='close'},
  'close-j':async function(){var j=ui.jSel||cfg().jornada;ui.confirm=null;await rpc('admin_close_jornada',{p_j:+j});ui.jSel=null;toast('Jornada '+j+' lista.')},
  deal:async function(){var n=await rpc('admin_deal_missing');toast(n+' plantilla(s) repartida(s).')},
  'mk-open':async function(){var n=await rpc('admin_open_market');toast('Mercado abierto con '+n+' jugadores.')},
  'mk-close':async function(){var n=await rpc('admin_close_market');toast('Mercado cerrado: '+n+' fichajes.')},
  'mk-close-open':async function(){var n=await rpc('admin_close_market');var m=await rpc('admin_open_market');toast(n+' fichajes. Nuevo mercado con '+m+' jugadores.')},
  cash:async function(b){var u=b.dataset.u,v=parseFloat(val('cash-'+u));if(isNaN(v))return;await q(sb.from('managers').update({cash:r1(v)}).eq('id',u));delete drafts['cash-'+u];toast('Caja actualizada.')},
  'kick-ask':function(b){ui.confirm='kick:'+b.dataset.u},
  kick:async function(b){await rpc('admin_kick',{p_user:b.dataset.u});ui.confirm=null;toast('Participante fuera; sus jugadores quedaron libres.')},
  'cfg-save':async function(){var n=function(id,d){var v=parseFloat(val(id));return isNaN(v)?d:v};var c=cfg();
    var teams=val('c-teams').split(/\r?\n/).map(function(s){return s.trim()}).filter(Boolean);
    await saveCfg({startCash:n('c-start',c.startCash),pointValue:n('c-pv',c.pointValue),marketSize:Math.round(n('c-mk',c.marketSize)),maxSquad:Math.round(n('c-max',c.maxSquad)),lockDays:n('c-lock',c.lockDays),clauseRaise:Math.min(1,Math.max(0,n('c-cr',c.clauseRaise))),quickSale:Math.min(1,Math.max(0,n('c-qs',c.quickSale))),
      squad:{PT:Math.round(n('c-sPT',c.squad.PT)),DF:Math.round(n('c-sDF',c.squad.DF)),MC:Math.round(n('c-sMC',c.squad.MC)),DC:Math.round(n('c-sDC',c.squad.DC))},jornada:Math.min(JORNADAS,Math.max(1,Math.round(n('c-j',c.jornada)))),teams:teams.length?teams:c.teams});
    clearDrafts('c-');toast('Reglas guardadas.')}
};
function toThumb(file){return new Promise(function(res,rej){var img=new Image(),url=URL.createObjectURL(file);
  img.onload=function(){var w=img.naturalWidth,hh=img.naturalHeight,s=Math.min(w,hh),c=document.createElement('canvas');c.width=c.height=128;
    c.getContext('2d').drawImage(img,(w-s)/2,Math.max(0,(hh-s)*0.12),s,s,0,0,128,128);URL.revokeObjectURL(url);res(c.toDataURL('image/jpeg',0.82))};
  img.onerror=function(){URL.revokeObjectURL(url);rej(new Error('No se pudo leer la imagen'))};img.src=url})}
async function savePhoto(id,file){var src=await toThumb(file);await q(sb.from('photos').upsert({id:id,src:src}))}
async function bulkPhotos(files){var ok=0,miss=[],dup=[];
  for(var i=0;i<files.length;i++){var f=files[i];var key=fold(f.name.replace(/\.[a-z0-9]+$/i,'').replace(/[_\-]+/g,' ').replace(/\s+/g,' '));
    var m=Object.keys(S.players).filter(function(id){var p=S.players[id];return fold(p.name)===key&&(!ui.fTeam||p.team===ui.fTeam)});
    if(!m.length){miss.push(f.name);continue}if(m.length>1){dup.push(f.name);continue}
    await savePhoto(m[0],f);ok++;toast('Subiendo fotos… '+(i+1)+' de '+files.length)}
  toast(ok+' fotos guardadas'+(miss.length?'. Sin coincidencia: '+miss.slice(0,5).join(', ')+(miss.length>5?'…':''):'')+(dup.length?'. Nombre repetido (filtra por equipo): '+dup.slice(0,3).join(', '):''),miss.length+dup.length>0)}

view.addEventListener('click',function(e){
  var g=e.target.closest('[data-gate]');
  if(g){if(g.dataset.gate==='google')sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname}});else if(g.dataset.gate==='logout')sb.auth.signOut().then(function(){location.reload()});return}
  var b=e.target.closest('[data-act]');if(!b||b.tagName==='SELECT'||b.tagName==='INPUT')return;
  var fn=A[b.dataset.act];if(!fn)return;
  if(fn.constructor.name==='AsyncFunction')busyWrap(fn)(b);
  else{fn(b);render(true)}
});
document.addEventListener('click',function(e){if(e.target&&e.target.id==='logout')sb.auth.signOut().then(function(){location.reload()})});
view.addEventListener('toggle',function(e){var d=e.target;if(d.dataset&&d.dataset.riv){ui.expand=d.open?'riv:'+d.dataset.riv:(ui.expand==='riv:'+d.dataset.riv?null:ui.expand)}},true);
view.addEventListener('input',function(e){var t=e.target;if(!t.id)return;
  if(t.dataset.cs){ui.calcS[t.dataset.cs]=Math.max(0,parseInt(t.value,10)||0);var p=P(ui.calc);var el=document.getElementById('calcTotal');if(p&&el)el.textContent=calcular(p.pos,ui.calcS);return}
  if(!t.dataset.f&&!t.dataset.pts&&!t.dataset.act)drafts[t.id]=t.value});
view.addEventListener('keydown',function(e){if(e.key!=='Enter')return;var t=e.target;
  if(t.id==='af-q'){ui.q=t.value;render(true)}else if(t.id==='teamName'){busyWrap(A.join)()}else if(t.id&&t.id.indexOf('bid-')===0){busyWrap(A.bid)({dataset:{id:t.id.slice(4)}})}});
view.addEventListener('change',function(e){var t=e.target;
  if(t.dataset.photo&&t.files&&t.files[0]){var f=t.files[0],pid=t.dataset.photo;busyWrap(async function(){await savePhoto(pid,f);toast('Foto guardada.')})();return}
  if(t.dataset.bulk&&t.files&&t.files.length){var fs=Array.prototype.slice.call(t.files);busyWrap(async function(){await bulkPhotos(fs)})();return}
  if(t.dataset.act==='formation'){var f=t.value,cnt=formCounts(f),seen={PT:0,DF:0,MC:0,DC:0};
    var l=myLineup().filter(function(id){var p=S.players[id];seen[p.pos]++;return seen[p.pos]<=cnt[p.pos]});
    busyWrap(async function(){await rpc('set_lineup',{p_formation:f,p_lineup:l})})();return}
  if(t.dataset.act==='filter'){ui.fTeam=val('af-team');ui.fPos=val('af-pos');render(true);return}
  if(t.dataset.act==='pj'){ui.jSel=+t.value;ui.calc=null;render(true);return}
  if(t.dataset.act==='pteam'){ui.pTeam=t.value;render(true);return}
  if(t.dataset.act==='pown'){ui.ownedOnly=t.checked;render(true);return}
  if(t.dataset.pts){var j=ui.jSel||cfg().jornada;var v=t.value.trim();var n=v===''?null:parseInt(v,10);if(v!==''&&isNaN(n))return;
    busyWrap(async function(){await setPts(j,t.dataset.pts,n)})();return}
  if(t.dataset.f){var id=t.dataset.id,f2=t.dataset.f,v2=t.value,patch={};
    if(f2==='value'){v2=r1(parseFloat(v2));if(isNaN(v2))return}
    if(f2==='name'){v2=v2.trim();if(!v2)return}
    busyWrap(async function(){
      if(f2==='owner'){await rpc('admin_set_owner',{p_id:id,p_user:v2||null});return}
      patch[f2]=v2;await q(sb.from('players').update(patch).eq('id',id))})();return}
});

// ---------- datos ----------
var LOADERS={
  config:async function(){var d=await q(sb.from('config').select('data').eq('id',1).maybeSingle());S.cfg=d?d.data:{};S.cfgExists=!!d},
  players:async function(){var d=await q(sb.from('players').select('*').limit(2000));var o={};d.forEach(function(r){o[r.id]={name:r.name,team:r.team,pos:r.pos,num:r.num,value:Number(r.value),owner:r.owner,clause:r.clause==null?null:Number(r.clause),signedAt:r.signed_at,sale:r.sale_price==null?null:{price:Number(r.sale_price),at:r.sale_at}}});S.players=o},
  photos:async function(){var d=await q(sb.from('photos').select('*').limit(2000));var o={};d.forEach(function(r){o[r.id]=r.src});S.photos=o},
  managers:async function(){var d=await q(sb.from('managers').select('*'));var o={};d.forEach(function(r){o[r.id]={teamName:r.team_name,cash:Number(r.cash),formation:r.formation,lineup:r.lineup||[]}});S.managers=o},
  market:async function(){var d=await q(sb.from('market').select('*').eq('id',1).maybeSingle());S.market={ids:(d&&d.ids)||[],openedAt:d&&d.opened_at}},
  feed:async function(){var d=await q(sb.from('feed').select('*').order('id',{ascending:false}).limit(40));S.feed=d.map(function(r){return {t:r.t,text:r.text}})},
  points:async function(){var d=await q(sb.from('points').select('*').limit(10000));var o={};d.forEach(function(r){(o[r.jornada]=o[r.jornada]||{})[r.player_id]=r.pts});S.points=o},
  results:async function(){var d=await q(sb.from('results').select('*'));var o={};d.forEach(function(r){o[r.jornada]={scores:r.scores||{},lineups:r.lineups||{}}});S.results=o},
  bids:async function(){var d=await q(sb.from('bids').select('*'));var mineB={},all={};d.forEach(function(r){var e={amount:Number(r.amount),at:r.at};if(r.user_id===S.uid)mineB[r.player_id]=e;(all[r.user_id]=all[r.user_id]||{})[r.player_id]=e});S.myBids=mineB;S.allBids=S.owner?all:null},
  members:async function(){var d=await q(sb.from('members').select('*'));S.members=d;var o={};d.forEach(function(m){o[m.user_id]={name:m.name||m.email||''}});S.profiles=o}
};
async function reload(t){try{await LOADERS[t]()}catch(e){console.error(t,e)}}
async function reloadAll(){if(S.phase!=='app')return;await Promise.all(Object.keys(LOADERS).map(reload))}
var pendingT={},tmr=0;
function onChange(t){pendingT[t]=1;clearTimeout(tmr);tmr=setTimeout(function(){var ts=Object.keys(pendingT);pendingT={};Promise.all(ts.map(reload)).then(function(){render()})},250)}

async function enter(){
  me=await rpc('register_me');S.uid=session.user.id;S.owner=!!me.is_admin&&me.status==='approved';
  if(me.status==='pending'){S.phase='pending';doRender();setTimeout(enter,15000);return}
  if(me.status==='rejected'){S.phase='rejected';doRender();return}
  S.phase='app';if(ui.tab==='admin'&&!S.owner)ui.tab='equipo';
  await reloadAll();S.ready=true;render(true);
  var ch=sb.channel('liga');
  Object.keys(LOADERS).forEach(function(t){ch.on('postgres_changes',{event:'*',schema:'public',table:t},function(){onChange(t)})});
  ch.subscribe();
  document.addEventListener('visibilitychange',function(){if(!document.hidden)reloadAll().then(function(){render()})});
}
async function boot(){
  try{var t=localStorage.getItem('fmx-tab');if(t)ui.tab=t}catch(_){}
  if(!SUPABASE_URL||SUPABASE_URL.indexOf('TU-PROYECTO')!==-1){S.phase='noconfig';doRender();return}
  sb=createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
  var r=await sb.auth.getSession();session=r.data.session;
  sb.auth.onAuthStateChange(function(ev,s){if(ev==='SIGNED_IN'&&!session){session=s;enter().catch(fail)}});
  if(!session){S.phase='login';doRender();return}
  await enter();
}
function fail(e){console.error(e);S.phase='error';S.err=(e&&e.message)||String(e);doRender()}
boot().catch(fail);
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(function(){});
