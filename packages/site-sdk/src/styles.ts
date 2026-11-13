/** Component CSS. Inlined once per page and covered by a CSP hash; uses only theme custom properties. */
export const SITE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--s-bg);color:var(--s-text);font-family:var(--s-font);font-size:1.0625rem;line-height:1.6}
h1,h2,h3,h4{font-family:var(--s-heading-font);line-height:1.2;margin:0 0 .5em;text-wrap:balance}
h1{font-size:clamp(2rem,6vw,var(--s-h1))}h2{font-size:clamp(1.5rem,4vw,var(--s-h2))}h3{font-size:var(--s-h3)}h4{font-size:var(--s-h4)}
p{margin:0 0 1em}
a{color:var(--s-primary);text-underline-offset:.15em}
a:focus-visible,button:focus-visible,summary:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid var(--s-primary);outline-offset:2px}
img{max-width:100%;height:auto;display:block}
.s-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.s-skip{position:absolute;left:1rem;top:-4rem;background:var(--s-primary);color:var(--s-on-primary);padding:.5rem 1rem;border-radius:var(--s-radius);z-index:10}
.s-skip:focus{top:1rem}
.s-wrap{max-width:72rem;margin:0 auto;padding:0 1rem}
.s-narrow{max-width:46rem}
.s-section{padding:calc(3.5rem*var(--s-space)) 0}
.s-section+.s-section{padding-top:calc(1.5rem*var(--s-space))}
.s-lead{font-size:1.2rem;color:var(--s-muted);max-width:42rem}
.s-muted{color:var(--s-muted)}.s-small{font-size:.9rem}.s-center{text-align:center}
.s-actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.25rem}
.s-btn{display:inline-flex;align-items:center;min-height:2.75rem;padding:.5rem 1.25rem;border-radius:var(--s-radius);font-weight:600;text-decoration:none;border:2px solid var(--s-primary);cursor:pointer;font:inherit;font-weight:600}
.s-btn-primary{background:var(--s-primary);color:var(--s-on-primary)}
.s-btn-secondary{background:transparent;color:var(--s-primary)}
.s-header{border-bottom:1px solid var(--s-surface)}
.s-header-row{display:flex;align-items:center;gap:1rem;min-height:4rem;flex-wrap:wrap}
.s-brand{font-weight:700;font-size:1.15rem;color:var(--s-text);text-decoration:none;margin-right:auto}
.s-logo{max-height:2.5rem;width:auto}
.s-nav-list{list-style:none;display:flex;flex-wrap:wrap;gap:1.25rem;margin:0;padding:0}
.s-nav-list a{color:var(--s-text);text-decoration:none}
.s-nav-list a[aria-current=page]{text-decoration:underline;text-decoration-thickness:2px}
.s-nav-narrow{display:none}
.s-nav-narrow summary{cursor:pointer;min-height:2.75rem;display:flex;align-items:center;padding:0 .5rem}
@media (max-width:700px){.s-nav-wide{display:none}.s-nav-narrow{display:block}.s-nav-narrow .s-nav-list{flex-direction:column;gap:.5rem;padding:.5rem 0}}
.s-hero{padding-top:calc(4.5rem*var(--s-space))}
.s-align-center .s-hero-copy{text-align:center;margin:0 auto}.s-align-center .s-actions{justify-content:center}.s-align-center .s-lead{margin:0 auto}
.s-split{display:grid;gap:2rem;align-items:center}
@media (min-width:900px){.s-split{grid-template-columns:1fr 1fr}.s-image-end>:first-child{order:2}}
.s-hero-img,.s-media{border-radius:var(--s-radius)}
.s-grid{list-style:none;padding:0;margin:1.5rem 0 0;display:grid;gap:1.25rem;grid-template-columns:1fr}
@media (min-width:640px){.s-cols-2,.s-cols-3,.s-cols-4{grid-template-columns:repeat(2,1fr)}}
@media (min-width:960px){.s-cols-3{grid-template-columns:repeat(3,1fr)}.s-cols-4{grid-template-columns:repeat(4,1fr)}}
.s-card{background:var(--s-surface);border-radius:var(--s-radius);padding:1.25rem}
.s-card h3,.s-card h2{font-size:var(--s-h4)}
.s-card-img{border-radius:var(--s-radius);margin-bottom:.75rem}
.s-list{list-style:none;padding:0;margin:1rem 0 0}.s-list-item{padding:1rem 0;border-bottom:1px solid var(--s-surface)}
.s-gallery{list-style:none;padding:0;margin:1rem 0 0;display:grid;gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(10rem,1fr))}
.s-gallery figure{margin:0}.s-gallery figcaption{font-size:.9rem;color:var(--s-muted);margin-top:.25rem}
.s-thumb{padding:0;border:0;background:none;cursor:zoom-in;display:block;width:100%;border-radius:var(--s-radius);overflow:hidden}
.s-lightbox{border:0;padding:1rem;background:var(--s-bg);color:var(--s-text);max-width:min(64rem,95vw);max-height:95vh;border-radius:var(--s-radius)}
.s-lightbox::backdrop{background:rgb(0 0 0/.75)}
.s-lightbox img{max-height:80vh;width:auto;margin:0 auto .75rem}
.s-person{text-align:center}.s-avatar{width:8rem;height:8rem;object-fit:cover;border-radius:50%;margin:0 auto .75rem}
.s-avatar-sm{width:3rem;height:3rem;object-fit:cover;border-radius:50%}
.s-quote{margin:0}.s-quote blockquote{margin:0 0 1rem;font-size:1.1rem}.s-quote figcaption{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}
.s-faq details{border-bottom:1px solid var(--s-surface);padding:.75rem 0}
.s-faq summary{cursor:pointer;font-weight:600;min-height:2.75rem;display:flex;align-items:center}
.s-price{font-size:1.5rem;font-weight:700}
.s-plan-hi{outline:3px solid var(--s-primary)}
.s-checks{padding-left:1.2rem}
.s-cta-accent{background:var(--s-primary);color:var(--s-on-primary)}
.s-cta-accent .s-lead{color:var(--s-on-primary)}
.s-cta-accent .s-btn-secondary{color:var(--s-on-primary);border-color:var(--s-on-primary)}
.s-cta-subtle{background:var(--s-surface)}
.s-links{padding-left:1.2rem}
.s-logos{list-style:none;padding:0;margin:1rem 0 0;display:flex;flex-wrap:wrap;gap:2rem;justify-content:center;align-items:center}
.s-logos img{max-height:3rem;width:auto}
.s-prose ul,.s-prose ol{padding-left:1.4rem}
.s-form{display:grid;gap:1rem;margin-top:1rem}
.s-field{display:grid;gap:.35rem;border:0;padding:0;margin:0}
.s-field input:not([type=checkbox]),.s-field textarea,.s-field select{font:inherit;color:var(--s-text);background:var(--s-bg);border:1px solid var(--s-muted);border-radius:var(--s-radius);padding:.6rem .75rem;min-height:2.75rem;width:100%}
.s-check{display:flex;gap:.5rem;align-items:center}
.s-check input{width:1.25rem;height:1.25rem}
.s-hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.s-form-status:empty{display:none}
.s-ok,.s-err{padding:.75rem 1rem;border-radius:var(--s-radius);background:var(--s-surface);border-left:4px solid var(--s-primary)}
.s-err{border-left-color:#b42318}
.s-footer{border-top:1px solid var(--s-surface);padding:2rem 0;margin-top:2rem}
.s-footer-row{display:grid;gap:1rem}
.s-footer-links{list-style:none;display:flex;flex-wrap:wrap;gap:1.25rem;padding:0;margin:0}
.s-langs{display:flex;gap:.75rem;justify-content:flex-end;padding:.5rem 1rem;font-size:.9rem;max-width:72rem;margin:0 auto}
.s-preview{background:#7a2e0e;color:#fff;text-align:center;padding:.4rem;font-size:.9rem}
.s-img-missing{border:2px dashed var(--s-muted);padding:2rem;text-align:center;color:var(--s-muted);border-radius:var(--s-radius)}
.s-notfound{padding:6rem 0;text-align:center}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
`.replace(/\n/g, '');
