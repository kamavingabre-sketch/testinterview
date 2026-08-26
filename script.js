const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const storeKey = 'dashboard_contacts_v1';
const historyKey = 'dashboard_history_v1';
let contacts = JSON.parse(localStorage.getItem(storeKey) || '[]');
let history = JSON.parse(localStorage.getItem(historyKey) || '[]');
let selectedImage = null;

function save(){ localStorage.setItem(storeKey, JSON.stringify(contacts)); localStorage.setItem(historyKey, JSON.stringify(history)); }
function toast(message){ const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer=setTimeout(()=>el.classList.remove('show'),3000); }
function normalizePhone(value){ let p=value.trim().replace(/[\s().-]/g,''); if(p.startsWith('+'))p=p.slice(1); if(p.startsWith('0'))p='62'+p.slice(1); return p; }
function validPhone(p){ return /^62\d{8,14}$/.test(p); }
function escapeHtml(s=''){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));}
function rows(target, query=''){
  const q=query.toLowerCase(); const list=contacts.filter(c=>(c.name+' '+c.phone).toLowerCase().includes(q));
  $(target).innerHTML=list.map(c=>`<tr><td>${escapeHtml(c.name||'Tanpa nama')}</td><td>${escapeHtml(c.phone)}</td><td><span class="tag">Diizinkan</span></td><td><span class="status">● Siap</span></td><td><button class="row-action" data-delete="${c.id}" aria-label="Hapus kontak">Hapus</button></td></tr>`).join('');
  return list.length;
}
function render(){
  $('#totalContacts').textContent=contacts.length; $('#readyContacts').textContent=contacts.length; $('#sentCount').textContent=history.length;
  const n=rows('#contactRows',$('#searchInput').value); $('#tableCount').textContent=`${n} kontak`; $('#emptyState').style.display=n?'none':'block';
  const all=rows('#allContactRows',$('#contactSearch').value); $('#allEmpty').style.display=all?'none':'block';
  $('#historyList').innerHTML=history.length ? history.map(h=>`<div class="history-row"><div class="history-symbol">✓</div><div><strong>Pesan disiapkan</strong><p>${escapeHtml(h.date)} · ${h.count} kontak</p></div><span>${escapeHtml(h.preview)}</span></div>`).join('') : '<div class="empty-state"><div class="empty-icon">◷</div><strong>Belum ada aktivitas</strong><p>Pesan yang Anda siapkan akan muncul di sini.</p></div>';
  updateProgress();
}
function updateProgress(){const message=$('#messageInput').value.trim();const steps=(contacts.length?1:0)+(message?1:0);$('#progressBar').style.width=(steps/2*100)+'%';$('.percent').textContent=Math.round(steps/2*100)+'%';}
function showSection(id){ $$('.page-section').forEach(s=>s.classList.toggle('active-section',s.id===id)); $$('.nav-item').forEach(a=>a.classList.toggle('active',a.dataset.section===id)); $('#pageName').textContent={overview:'Ringkasan',contacts:'Kontak',campaign:'Buat pesan',history:'Aktivitas'}[id]||'Ringkasan'; window.scrollTo({top:0,behavior:'smooth'}); $('#sidebar').classList.remove('open'); }
$$('.nav-item').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();showSection(a.dataset.section)}));
$$('[data-section-target]').forEach(b=>b.addEventListener('click',()=>showSection(b.dataset.sectionTarget)));
$$('[data-scroll]').forEach(b=>b.addEventListener('click',()=>showSection(b.dataset.scroll)));
$('#openNav').onclick=()=>$('#sidebar').classList.add('open'); $('#closeNav').onclick=()=>$('#sidebar').classList.remove('open');
$('#openAddContact').onclick=()=>$('#contactModal').classList.add('show'); $('#closeModal').onclick=()=>$('#contactModal').classList.remove('show'); $('#contactModal').onclick=e=>{if(e.target.id==='contactModal')e.currentTarget.classList.remove('show')};
$('#addContactButton').onclick=()=>{const name=$('#nameInput').value.trim(),phone=normalizePhone($('#phoneInput').value);if(!validPhone(phone))return toast('Masukkan nomor Indonesia yang valid.');if(!$('#consentInput').checked)return toast('Konfirmasi izin kontak terlebih dahulu.');if(contacts.some(c=>c.phone===phone))return toast('Nomor tersebut sudah ada.');contacts.unshift({id:Date.now(),name,phone});save();render();$('#contactModal').classList.remove('show');$('#nameInput').value='';$('#phoneInput').value='';$('#consentInput').checked=false;toast('Kontak berhasil ditambahkan.');};
$('#importButton').onclick=()=>{const values=$('#bulkInput').value.split(/[\n,;]/).map(normalizePhone).filter(Boolean);let added=0, skipped=0;values.forEach(phone=>{if(validPhone(phone)&&!contacts.some(c=>c.phone===phone)){contacts.unshift({id:Date.now()+added,name:'',phone});added++}else skipped++});if(!added)return toast('Tidak ada nomor baru yang valid.');save();render();$('#bulkInput').value='';toast(`${added} kontak ditambahkan${skipped?' · '+skipped+' dilewati':''}.`)};
$('#csvFile').onchange=e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{$('#bulkInput').value=ev.target.result.split(/\r?\n/).map(r=>r.split(',')[0]).filter(Boolean).join('\n');toast('CSV siap diimpor. Periksa daftar lalu klik Impor kontak.');};reader.readAsText(file)};
$('#searchInput').oninput=render;$('#contactSearch').oninput=render;
document.addEventListener('click',e=>{const id=e.target.dataset.delete;if(id){contacts=contacts.filter(c=>String(c.id)!==id);save();render();toast('Kontak dihapus.')}});
$('#messageInput').oninput=()=>{$('#charCount').textContent=`${$('#messageInput').value.length.toLocaleString('id-ID')} / 4.000`;$('#previewBubble').textContent=$('#messageInput').value||'Pesan Anda akan muncul di sini.';updateProgress()};
$('#clearMessage').onclick=()=>{$('#messageInput').value='';$('#messageInput').dispatchEvent(new Event('input'))};
$('#imageInput').onchange=e=>{const file=e.target.files[0];if(!file)return;if(file.size>5*1024*1024)return toast('Ukuran gambar maksimal 5 MB.');selectedImage=file;$('#fileName').textContent=file.name;const r=new FileReader();r.onload=ev=>$('#imagePreview').innerHTML=`<img src="${ev.target.result}" alt="Pratinjau gambar"/>`;r.readAsDataURL(file);toast('Gambar ditambahkan ke draf.');};
function prepare(){const text=$('#messageInput').value.trim();if(!contacts.length)return toast('Tambahkan kontak berizin terlebih dahulu.');if(!text)return toast('Tulis isi pesan terlebih dahulu.');history.unshift({date:new Date().toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}),count:contacts.length,preview:text.slice(0,65)});save();render();const first=contacts[0];const url=`https://wa.me/${first.phone}?text=${encodeURIComponent(text)}`;window.open(url,'_blank','noopener');toast(`WhatsApp untuk ${first.name||first.phone} sudah disiapkan. Lanjutkan satu per satu agar aman.`);}
$('#prepareButton').onclick=prepare;$('#saveDraft').onclick=()=>toast('Draf tersimpan di browser ini.');$('#learnMore').onclick=e=>{e.preventDefault();toast('Selalu gunakan daftar kontak yang sudah opt-in.');};
render();
