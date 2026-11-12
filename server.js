import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
const app = express();
const PORT = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

const API_BASE = "https://v3.football.api-sports.io";
const apiKey = process.env.API_FOOTBALL_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

async function football(endpoint, params = {}) {
  if (!apiKey) throw new Error("API_FOOTBALL_KEY non configurata nel file .env");
  const url = new URL(API_BASE + endpoint);
  for (const [k,v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { "x-apisports-key": apiKey } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errors && Object.keys(data.errors).length) {
    throw new Error(`API-Football ${res.status}: ${JSON.stringify(data.errors || data.message || "richiesta fallita")}`);
  }
  return data.response || [];
}
const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
function poisson(k, lambda) { return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k); }
function factorial(x) { let a=1; for(let i=2;i<=x;i++) a*=i; return a; }
function poissonMarkets(homeLambda, awayLambda) {
  let h=0,d=0,a=0,o=0,btts=0;
  for(let i=0;i<=8;i++) for(let j=0;j<=8;j++) {
    const p=poisson(i,homeLambda)*poisson(j,awayLambda);
    if(i>j)h+=p; else if(i===j)d+=p; else a+=p;
    if(i+j>=3)o+=p;
    if(i>0&&j>0)btts+=p;
  }
  return {homeWin:h,draw:d,awayWin:a,over25:o,under25:1-o,bttsYes:btts,bttsNo:1-btts};
}
function teamRates(fixtures, teamId, side) {
  const rows=fixtures.map(x=>{
    const isHome=x.teams?.home?.id===teamId;
    const gf=n(isHome?x.goals?.home:x.goals?.away);
    const ga=n(isHome?x.goals?.away:x.goals?.home);
    return {gf,ga};
  }).filter(x=>Number.isFinite(x.gf)&&Number.isFinite(x.ga));
  if(!rows.length) return null;
  return {scored:rows.reduce((s,x)=>s+x.gf,0)/rows.length, conceded:rows.reduce((s,x)=>s+x.ga,0)/rows.length, matches:rows.length};
}
function pickOdds(oddsResponse) {
  const found={};
  for(const fixture of oddsResponse||[]) for(const bookmaker of fixture.bookmakers||[]) for(const bet of bookmaker.bets||[]) {
    const name=(bet.name||"").toLowerCase();
    for(const value of bet.values||[]) {
      const v=n(value.odd); if(v<1.01)continue;
      const label=(value.value||"").toLowerCase();
      if(name.includes("match winner")||name.includes("1x2")||name==="winner") {
        if(label==="home"||label==="1")found["1"]??=v;
        if(label==="draw"||label==="x")found["X"]??=v;
        if(label==="away"||label==="2")found["2"]??=v;
      }
      if(name.includes("both teams")||name.includes("both teams to score")) {
        if(label==="yes")found.Gol??=v; if(label==="no")found.NoGol??=v;
      }
      if(name.includes("over/under") && (label.includes("2.5")||label==="over 2.5"||label==="under 2.5")) {
        if(label.includes("over"))found["Over 2.5"]??=v; if(label.includes("under"))found["Under 2.5"]??=v;
      }
    }
  }
  return found;
}
function candidateMarkets(prob, odds) {
  const list=[
    ["1",prob.homeWin],["X",prob.draw],["2",prob.awayWin],
    ["Over 2.5",prob.over25],["Under 2.5",prob.under25],
    ["Gol",prob.bttsYes],["NoGol",prob.bttsNo]
  ];
  return list.filter(([m,p])=>odds[m] && p>0).map(([market,probability])=>({
    market, probability, odds:odds[market],
    impliedProbability:1/odds[market],
    edge:probability-(1/odds[market])
  }));
}
async function openAISelect(fixtures, settings) {
  if (!openaiKey) return null;
  const input = {
    profile: settings.profile, targetOdds: settings.targetOdds, count: settings.count,
    candidates: fixtures.map(f=>({id:f.id,home:f.home,away:f.away,league:f.league,markets:f.markets,
      probabilities:f.probabilities,form:f.form,injuries:f.injuries,headToHead:f.headToHead}))
  };
  const system = `Sei un assistente di analisi calcistica prudente. Usa esclusivamente i dati JSON forniti. Non inventare fatti, infortuni o statistiche. Scegli al massimo ${settings.count} selezioni distinte, privilegiando coerenza con profilo ${settings.profile} e quota combinata vicina a ${settings.targetOdds}. Le probabilità sono stime Poisson, non certezze. Restituisci SOLO JSON: {"picks":[{"fixtureId":numero,"market":"mercato esatto","reason":"motivazione breve basata sui dati"}]}.`;
  const res=await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",headers:{"Authorization":`Bearer ${openaiKey}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-4o-mini",temperature:0.2,response_format:{type:"json_object"},messages:[{role:"system",content:system},{role:"user",content:JSON.stringify(input)}]})
  });
  const data=await res.json();
  if(!res.ok) throw new Error(`OpenAI ${res.status}: ${data.error?.message||"richiesta fallita"}`);
  return JSON.parse(data.choices?.[0]?.message?.content||'{"picks":[]}').picks||[];
}
function profileFilter(markets, profile) {
  return markets.filter(m=>{
    if(profile==="safe") return m.probability>=0.75;
    if(profile==="balanced") return m.probability>=0.55&&m.probability<0.75;
    if(profile==="value") return m.edge>0.025;
    return m.odds>=2.2;
  });
}
app.get("/api/status",(req,res)=>res.json({apiFootball:Boolean(apiKey),openai:Boolean(openaiKey),model:process.env.OPENAI_MODEL||"gpt-4o-mini"}));
app.post("/api/analyze",async(req,res)=>{
 try {
  if(!apiKey) return res.status(503).json({error:"Configura API_FOOTBALL_KEY nel file .env del server."});
  const date=String(req.body.date||new Date().toISOString().slice(0,10));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({error:"Data non valida."});
  const settings={count:Math.max(2,Math.min(15,Number(req.body.count)||4)),profile:["safe","balanced","value","bomb"].includes(req.body.profile)?req.body.profile:"balanced",targetOdds:Math.max(1.01,Number(req.body.targetOdds)||6)};
  const maxFixtures=Math.max(2,Math.min(15,Number(req.body.maxFixtures)||10));
  const raw=await football("/fixtures",{date,timezone:"Europe/Rome"});
  const topNames = /premier league|serie a|la liga|bundesliga|ligue 1|champions league|europa league|conference league|serie b|eredivisie|primeira liga/i;
  const eligible = raw.filter(f=>["NS","TBD","PST"].includes(f.fixture?.status?.short));
  const scoped = req.body.leagueScope === "top" ? eligible.filter(f=>topNames.test(f.league?.name||"")) : eligible;
  const scheduled=scoped.slice(0, maxFixtures);
  if(!scheduled.length) return res.json({meta:{fixturesFound:raw.length,analyzed:0,aiUsed:false},recommendations:[],warnings:["Nessuna partita non iniziata trovata per questa data."]});
  const warnings=[];
  const enriched=[];
  for(const f of scheduled) {
    const homeId=f.teams.home.id,awayId=f.teams.away.id,leagueId=f.league.id,season=f.league.season;
    const [homeLast,awayLast,odds,injuries,h2h] = await Promise.all([
      football("/fixtures",{team:homeId,last:5,season,timezone:"Europe/Rome"}).catch(()=>[]),
      football("/fixtures",{team:awayId,last:5,season,timezone:"Europe/Rome"}).catch(()=>[]),
      football("/odds",{fixture:f.fixture.id}).catch(()=>[]),
      football("/injuries",{fixture:f.fixture.id}).catch(()=>[]),
      football("/fixtures/headtohead",{h2h:`${homeId}-${awayId}`,last:5}).catch(()=>[])
    ]);
    const hr=teamRates(homeLast,homeId), ar=teamRates(awayLast,awayId);
    const homeAttack=hr?.scored??1.35, homeDefense=hr?.conceded??1.1;
    const awayAttack=ar?.scored??1.1, awayDefense=ar?.conceded??1.35;
    // Blend recent scoring/conceding rates with conservative home/away baselines.
    const lh=Math.max(.15,Math.min(3.5,0.65*((homeAttack+awayDefense)/2)+0.35*1.45));
    const la=Math.max(.15,Math.min(3.2,0.65*((awayAttack+homeDefense)/2)+0.35*1.10));
    const probabilities=poissonMarkets(lh,la);
    const marketOdds=pickOdds(odds);
    const markets=profileFilter(candidateMarkets(probabilities,marketOdds),settings.profile);
    const injuryNames=injuries.slice(0,12).map(x=>`${x.player?.name||"Giocatore"} (${x.player?.type||x.player?.reason||"assenza"})`);
    enriched.push({
      id:f.fixture.id,home:f.teams.home.name,away:f.teams.away.name,league:f.league.name,
      kickoff:f.fixture.date,markets,probabilities,lambda:{home:lh,away:la},
      form:{home:hr,away:ar},injuries:injuryNames,headToHead:h2h.slice(0,5).map(x=>({home:x.teams?.home?.name,away:x.teams?.away?.name,score:`${x.goals?.home}-${x.goals?.away}`})),
      oddsAvailable:Object.keys(marketOdds).length>0
    });
  }
  const usable=enriched.filter(x=>x.markets.length);
  let aiPicks=null;
  if(openaiKey&&usable.length) {
    try { aiPicks=await openAISelect(usable,settings); }
    catch(e){warnings.push(`OpenAI non disponibile: ${e.message}`);}
  } else if(!openaiKey) warnings.push("OPENAI_API_KEY assente: selezione basata solo sul filtro statistico.");
  const selected=[];
  if(aiPicks) for(const p of aiPicks) {
    const f=usable.find(x=>x.id===Number(p.fixtureId)); const m=f?.markets.find(x=>x.market===p.market);
    if(f&&m&&!selected.some(x=>x.fixtureId===f.id)) selected.push({...m,fixtureId:f.id,home:f.home,away:f.away,league:f.league,kickoff:f.kickoff,probabilities:f.probabilities,reason:String(p.reason||"Selezione AI sui dati disponibili."),form:f.form,injuries:f.injuries});
  }
  if(!selected.length) {
    const flat=usable.flatMap(f=>f.markets.map(m=>({...m,fixtureId:f.id,home:f.home,away:f.away,league:f.league,kickoff:f.kickoff,probabilities:f.probabilities,reason:`Stima Poisson: λ casa ${f.lambda.home.toFixed(2)}, λ trasferta ${f.lambda.away.toFixed(2)}. Forma ultime gare disponibili: ${f.form.home?.matches||0}/${f.form.away?.matches||0} partite.`,form:f.form,injuries:f.injuries})));
    flat.sort((a,b)=>settings.profile==="bomb"?b.odds-a.odds:settings.profile==="value"?b.edge-a.edge:b.probability-a.probability);
    const seen=new Set();for(const p of flat){if(seen.has(p.fixtureId))continue;selected.push(p);seen.add(p.fixtureId);if(selected.length>=settings.count)break;}
  }
  const recommendations=selected.slice(0,settings.count).map(p=>({
    ...p,impliedProbability:p.impliedProbability,
    kickoff:p.kickoff?new Date(p.kickoff).toLocaleString("it-IT",{timeZone:"Europe/Rome"}):""
  }));
  return res.json({meta:{fixturesFound:raw.length,analyzed:enriched.length,aiUsed:Boolean(aiPicks?.length)},recommendations,warnings});
 } catch(e) { console.error(e); res.status(500).json({error:e.message||"Errore interno del server."}); }
});
app.listen(PORT,()=>console.log(`Tracker Schedine attivo su http://localhost:${PORT}`));
