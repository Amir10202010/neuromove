// Calibration of CUSUM (k = 0.5) and EWMA (λ = 0.25) thresholds for i.i.d. N(0,1) residuals over (horizon − 2) points.
function rng(seed){let a=seed>>>0,spare=null;const next=()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};return{normal(){if(spare!==null){const v=spare;spare=null;return v}let u=0;while(u===0)u=next();const v=next();const r=Math.sqrt(-2*Math.log(u));spare=r*Math.sin(2*Math.PI*v);return r*Math.cos(2*Math.PI*v)}}}
const R=200000,K=0.5,LAM=0.25;
const out={};
for(const horizon of [10,20,40]){
  const g=rng(20261110+horizon);const L=horizon-2;const mc=new Float64Array(R),me=new Float64Array(R);
  for(let r=0;r<R;r++){let cp=0,cn=0,zz=0,a=0,b=0;for(let i=0;i<L;i++){const u=g.normal();cp=Math.max(0,cp+u-K);cn=Math.max(0,cn-u-K);a=Math.max(a,cp,cn);zz=LAM*u+(1-LAM)*zz;b=Math.max(b,Math.abs(zz)/Math.sqrt((LAM/(2-LAM))*(1-(1-LAM)**(2*(i+1)))))}mc[r]=a;me[r]=b}
  mc.sort();me.sort();
  out[horizon]=[0.05,0.025,0.0167,0.0125,0.01,0.005].map(alpha=>({alpha,cusumH:+mc[Math.ceil((1-alpha)*R)-1].toFixed(3),ewmaL:+me[Math.ceil((1-alpha)*R)-1].toFixed(3)}));
}
console.log(JSON.stringify(out,null,1));
