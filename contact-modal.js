const CONTACT_API = 'https://selfactual-waitlist.selfactual.workers.dev/contact';

document.addEventListener('DOMContentLoaded', () => {
  const modal = document.createElement('div');
  modal.id = 'contact-modal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal__backdrop" onclick="closeContactModal()"></div>
    <div class="modal__content">
      <button class="modal__close" onclick="closeContactModal()" aria-label="Close">&times;</button>
      <h2 style="margin-bottom: var(--space-xs);">Get in touch</h2>
      <p style="color: var(--text-secondary); margin-bottom: var(--space-md); font-size: 0.95rem;">
        Questions, feedback, investor interest, partnership ideas — we'd love to hear from you.
      </p>
      <form id="contact-form" class="contact-form" onsubmit="handleContact(event)">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-xs);">
          <input type="text" name="name" placeholder="Your name" aria-label="Your name">
          <input type="email" name="email" placeholder="your@email.com" aria-label="Email address" required>
        </div>
        <select name="category" aria-label="Category">
          <option value="">What's this about?</option>
          <option value="General">General question</option>
          <option value="Support">Support</option>
          <option value="Investor">Investor interest</option>
          <option value="Partnership">Partnership</option>
          <option value="Other">Other</option>
        </select>
        <textarea name="message" placeholder="Your message" aria-label="Message" required></textarea>
        <button type="submit" class="btn btn--primary" style="width: 100%;">Send Message</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
});

function openContactModal() {
  document.getElementById('contact-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeContactModal() {
  document.getElementById('contact-modal').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeContactModal();
});

async function handleContact(e) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  const name = form.name.value.trim();
  const email = form.email.value.trim();
  const category = form.category.value;
  const message = form.message.value.trim();

  if (!email || !email.includes('@')) return;
  if (!message) return;

  btn.textContent = 'Sending...';
  btn.disabled = true;

  try {
    const res = await fetch(CONTACT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, category, message }),
    });

    if (res.ok) {
      btn.textContent = 'Message sent \u2713';
      btn.style.background = 'var(--cyan)';
      form.querySelectorAll('input, select, textarea').forEach(el => el.disabled = true);
      setTimeout(() => {
        closeContactModal();
        form.reset();
        form.querySelectorAll('input, select, textarea').forEach(el => el.disabled = false);
        btn.textContent = 'Send Message';
        btn.style.background = '';
        btn.disabled = false;
      }, 2000);
    } else {
      btn.textContent = 'Something went wrong';
      btn.style.background = 'var(--coral)';
      btn.disabled = false;
    }
  } catch (err) {
    btn.textContent = 'Something went wrong';
    btn.style.background = 'var(--coral)';
    btn.disabled = false;
  }
}
