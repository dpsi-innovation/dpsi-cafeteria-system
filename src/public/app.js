// src/public/app.js
// Client-side interactions & API communication with exact DPS SchoolsOS layout

let allStudents = [];
let currentActiveStudent = null;
let menuCatalog = [];
let cart = [];
let prebookCart = [];
let pendingTopupData = null;

// Switch Sidebar Navigation
function switchNav(navId) {
  document.querySelectorAll('.view-pane').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.menu-link').forEach(item => item.classList.remove('active'));

  const targetView = document.getElementById(`view-${navId}`);
  const targetNav = document.getElementById(`nav-${navId}`);

  if (targetView) targetView.classList.add('active');
  if (targetNav) targetNav.classList.add('active');

  if (navId === 'cafeteria') {
    switchCafeTab('tab-prebook');
  }
}

// Switch Sub-tabs inside Cafeteria
function switchCafeTab(tabId) {
  document.querySelectorAll('.cafe-sub-view').forEach(v => v.style.display = 'none');
  document.querySelectorAll('.cafe-tab-btn').forEach(b => b.classList.remove('active'));

  const activeView = document.getElementById(tabId);
  if (activeView) activeView.style.display = 'block';

  const tabIndex = ['tab-prebook', 'tab-topup', 'tab-pass', 'tab-pos'].indexOf(tabId);
  const btns = document.querySelectorAll('.cafe-tab-btn');
  if (btns[tabIndex]) btns[tabIndex].classList.add('active');

  if (tabId === 'tab-prebook' && currentActiveStudent) {
    loadPrebookHistory(currentActiveStudent.id);
  }
}

// Toast notification
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span> ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Helper for Initials
function getInitials(name) {
  if (!name) return 'ST';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Format date helper: YYYY-MM-DD
function getFormattedDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function setPrebookQuickDate(offsetDays) {
  const dateInput = document.getElementById('prebook-date');
  if (dateInput) {
    dateInput.value = getFormattedDate(offsetDays);
    showToast(`Meal date set to ${dateInput.value}`, 'info');
  }
}

// -------------------------------------------------------------
// CORE STUDENT ISOLATION ENGINE
// -------------------------------------------------------------
async function loadStudents() {
  try {
    const res = await fetch('/api/students');
    const data = await res.json();
    allStudents = data.students || [];

    const selector = document.getElementById('topbar-student-selector');
    selector.innerHTML = '';

    allStudents.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.admission_number;
      opt.innerText = `${s.name} (${s.admission_number})`;
      selector.appendChild(opt);
    });

    if (allStudents.length > 0) {
      setActiveStudent(allStudents[0]);
    }
  } catch (err) {
    console.error('Failed to load students:', err);
    showToast('Failed to load student profiles', 'error');
  }
}

async function handleStudentChange(admissionNumber) {
  try {
    const res = await fetch(`/api/students/lookup/${encodeURIComponent(admissionNumber)}`);
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Student not found', 'error');
      return;
    }

    setActiveStudent(data.student);
    showToast(`Switched account to ${data.student.name} (${data.student.admission_number})`, 'info');
  } catch (err) {
    console.error(err);
    showToast('Error switching student profile', 'error');
  }
}

function setActiveStudent(student) {
  currentActiveStudent = student;
  const initials = getInitials(student.name);

  // Update Topbar Profile Pill
  document.getElementById('top-user-name').innerText = student.name.toUpperCase();
  document.getElementById('top-user-id').innerText = `(${student.admission_number})`;
  document.getElementById('top-user-role').innerText = `${student.class_name}-${student.section} • Student Portal`;
  document.getElementById('top-avatar').innerText = initials;

  const selector = document.getElementById('topbar-student-selector');
  if (selector && selector.value !== student.admission_number) {
    selector.value = student.admission_number;
  }

  // Update Golden Hero Card on Dashboard
  document.getElementById('hero-display-name').innerText = student.name.toUpperCase();
  document.getElementById('hero-display-id').innerText = student.admission_number;
  document.getElementById('hero-role-tag').innerText = `${student.class_name} - SECTION ${student.section}`;
  document.getElementById('hero-avatar-initials').innerText = initials;

  // Update Cafeteria Active Pill
  const cafePill = document.getElementById('active-student-pill');
  if (cafePill) {
    cafePill.innerText = `${student.name} (${student.admission_number})`;
  }

  // Update Pre-Booking labels
  const prebookLabel = document.getElementById('prebook-student-label');
  if (prebookLabel) prebookLabel.innerText = `${student.name} (${student.admission_number})`;
  const prebookBalDisp = document.getElementById('prebook-wallet-balance-disp');
  if (prebookBalDisp) prebookBalDisp.innerText = `₹${student.balance.toFixed(2)}`;

  // Update Cafeteria Tab 1 (Top-up) Info
  document.getElementById('panel-name').innerText = student.name;
  document.getElementById('panel-meta').innerHTML = `${student.class_name}-${student.section} &bull; Adm No: <strong>${student.admission_number}</strong>`;
  document.getElementById('panel-balance').innerText = `₹${student.balance.toFixed(2)}`;
  document.getElementById('panel-limit').innerText = `₹${student.daily_limit.toFixed(2)}`;
  document.getElementById('panel-parent').innerText = student.parent_name;
  document.getElementById('panel-phone').innerText = student.parent_phone;

  // Update Student Pass Card
  document.getElementById('kiosk-name').innerText = student.name;
  document.getElementById('kiosk-meta').innerHTML = `${student.class_name}-${student.section} &bull; Adm: <strong>${student.admission_number}</strong>`;
  document.getElementById('kiosk-balance').innerText = `₹${student.balance.toFixed(2)}`;
  document.getElementById('kiosk-limit').innerText = `₹${student.daily_limit.toFixed(2)}`;

  clearCart();
  clearPrebookTray();

  // Load strictly isolated student transaction history & prebookings
  loadStudentTransactions(student.id);
  loadPrebookHistory(student.id);
}

// Load Transactions strictly for this student
async function loadStudentTransactions(studentId) {
  try {
    const res = await fetch(`/api/transactions/${studentId}`);
    const data = await res.json();
    
    const parentTbody = document.getElementById('parent-trans-tbody');
    const kioskTbody = document.getElementById('kiosk-history-tbody');
    parentTbody.innerHTML = '';
    kioskTbody.innerHTML = '';

    if (!data.transactions || data.transactions.length === 0) {
      const emptyRow = `<tr><td colspan="4" style="text-align: center; color: #94a3b8;">No transactions for this student</td></tr>`;
      parentTbody.innerHTML = emptyRow;
      kioskTbody.innerHTML = emptyRow;
      return;
    }

    data.transactions.forEach(t => {
      const isCredit = t.entry_type === 'CREDIT';
      
      const pTr = document.createElement('tr');
      pTr.innerHTML = `
        <td><span style="background:${isCredit ? '#dcfce7' : '#fee2e2'}; color:${isCredit ? '#15803d' : '#b91c1c'}; font-size:10px; font-weight:800; padding:2px 6px; border-radius:4px;">${t.reference_type}</span></td>
        <td style="font-weight: 700; color: ${isCredit ? '#059669' : '#dc2626'};">
          ${isCredit ? '+' : '-'} ₹${t.amount.toFixed(2)}
        </td>
        <td style="font-size: 0.78rem;">${t.description || '-'}</td>
        <td style="font-size: 0.72rem; color: #64748b;">${new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
      `;
      parentTbody.appendChild(pTr);

      const kTr = document.createElement('tr');
      kTr.innerHTML = `
        <td><span style="background:${isCredit ? '#dcfce7' : '#fee2e2'}; color:${isCredit ? '#15803d' : '#b91c1c'}; font-size:10px; font-weight:800; padding:2px 6px; border-radius:4px;">${t.entry_type}</span></td>
        <td style="font-weight:700; color: ${isCredit ? '#059669' : '#ef4444'};">${isCredit ? '+' : '-'} ₹${t.amount.toFixed(2)}</td>
        <td style="font-size:0.78rem;">${t.description}</td>
      `;
      kioskTbody.appendChild(kTr);
    });
  } catch (err) {
    console.error('Failed to load student transactions:', err);
  }
}

// -------------------------------------------------------------
// ADVANCE MEAL PRE-BOOKING LOGIC
// -------------------------------------------------------------
function addToPrebookTray(item) {
  const existing = prebookCart.find(c => c.id === item.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    prebookCart.push({ ...item, quantity: 1 });
  }
  renderPrebookTray();
}

function updatePrebookQty(itemId, delta) {
  const idx = prebookCart.findIndex(c => c.id === itemId);
  if (idx !== -1) {
    prebookCart[idx].quantity += delta;
    if (prebookCart[idx].quantity <= 0) {
      prebookCart.splice(idx, 1);
    }
  }
  renderPrebookTray();
}

function clearPrebookTray() {
  prebookCart = [];
  renderPrebookTray();
}

function renderPrebookTray() {
  const tbody = document.getElementById('prebook-cart-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const walletBtn = document.getElementById('prebook-wallet-btn');
  const rzpBtn = document.getElementById('prebook-razorpay-btn');

  if (prebookCart.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #94a3b8;">No items in meal pack yet. Click items on the left.</td></tr>`;
    document.getElementById('prebook-total-amount').innerText = '₹0.00';
    if (walletBtn) walletBtn.disabled = true;
    if (rzpBtn) rzpBtn.disabled = true;
    return;
  }

  let totalAmount = 0;

  prebookCart.forEach(item => {
    const itemTotal = item.price * item.quantity;
    totalAmount += itemTotal;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${item.name}</strong></td>
      <td>
        <button onclick="updatePrebookQty('${item.id}', -1)" style="padding: 1px 5px; border:1px solid #cbd5e1; background:#f8fafc; cursor:pointer;">-</button>
        <span style="margin: 0 4px; font-weight:700;">${item.quantity}</span>
        <button onclick="updatePrebookQty('${item.id}', 1)" style="padding: 1px 5px; border:1px solid #cbd5e1; background:#f8fafc; cursor:pointer;">+</button>
      </td>
      <td style="font-weight:700; color: #1e3a8a;">₹${itemTotal.toFixed(2)}</td>
      <td><button onclick="updatePrebookQty('${item.id}', -${item.quantity})" style="color:#ef4444; background:none; border:none; cursor:pointer; font-weight:bold;">&times;</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('prebook-total-amount').innerText = `₹${totalAmount.toFixed(2)}`;

  const hasFunds = currentActiveStudent && currentActiveStudent.balance >= totalAmount;
  if (walletBtn) walletBtn.disabled = !hasFunds;
  if (rzpBtn) rzpBtn.disabled = !(currentActiveStudent && totalAmount > 0);

  if (!hasFunds && walletBtn) {
    walletBtn.innerText = `⚠️ Low Balance (Needs ₹${totalAmount.toFixed(2)})`;
  } else if (walletBtn) {
    walletBtn.innerText = `✅ Pay with Wallet (₹${totalAmount.toFixed(2)})`;
  }
}

async function confirmPrebooking(paymentMode) {
  if (!currentActiveStudent) {
    showToast('Please select a student', 'error');
    return;
  }
  if (prebookCart.length === 0) {
    showToast('Please add food items to the meal tray', 'error');
    return;
  }

  const bookingDate = document.getElementById('prebook-date').value;
  if (!bookingDate) {
    showToast('Please select a date for the meal', 'error');
    return;
  }

  const mealType = document.getElementById('prebook-meal-type').value;
  const specialNotes = document.getElementById('prebook-notes').value;
  const totalAmount = prebookCart.reduce((acc, it) => acc + (it.price * it.quantity), 0);

  // If Razorpay requested, first execute demo top-up of the exact meal cost, then proceed
  if (paymentMode === 'RAZORPAY_DEMO') {
    pendingTopupData = {
      studentId: currentActiveStudent.id,
      admissionNumber: currentActiveStudent.admission_number,
      amount: totalAmount,
      studentName: currentActiveStudent.name,
      parentName: currentActiveStudent.parent_name,
      isPrebookingDirect: true,
      bookingPayload: {
        studentId: currentActiveStudent.id,
        bookingDate,
        mealType,
        items: prebookCart.map(it => ({ id: it.id, name: it.name, quantity: it.quantity })),
        specialNotes,
        paymentMode: 'RAZORPAY_DIRECT'
      }
    };

    document.getElementById('rzp-modal-amount').innerText = `₹${totalAmount.toFixed(2)}`;
    document.getElementById('rzp-modal-desc').innerText = `Advance Meal Pre-Book for ${bookingDate} (${currentActiveStudent.name})`;
    document.getElementById('razorpay-modal-overlay').classList.add('active');
    return;
  }

  // Direct Wallet payment
  try {
    const res = await fetch('/api/meal-bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: currentActiveStudent.id,
        bookingDate,
        mealType,
        items: prebookCart.map(it => ({ id: it.id, name: it.name, quantity: it.quantity })),
        specialNotes,
        paymentMode: 'WALLET'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Pre-booking failed', 'error');
      return;
    }

    showToast(`🎉 Meal booked for ${data.bookingDate}! Token Code: ${data.tokenCode}`, 'success');
    clearPrebookTray();
    document.getElementById('prebook-notes').value = '';

    // Refresh student data & booking history
    await handleStudentChange(currentActiveStudent.admission_number);
    loadPrebookHistory(currentActiveStudent.id);

  } catch (err) {
    console.error(err);
    showToast('Network error during advance booking', 'error');
  }
}

async function loadPrebookHistory(studentId) {
  const tbody = document.getElementById('prebook-history-tbody');
  if (!tbody || !studentId) return;

  try {
    const res = await fetch(`/api/meal-bookings/student/${studentId}`);
    const data = await res.json();
    tbody.innerHTML = '';

    if (!data.bookings || data.bookings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94a3b8;">No advance bookings yet for this student</td></tr>`;
      return;
    }

    data.bookings.forEach(b => {
      const itemsList = (b.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ');
      const isCollected = b.status === 'COLLECTED';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <strong>${b.booking_date}</strong><br>
          <span style="font-size: 0.7rem; color: #64748b;">${b.meal_type}</span>
        </td>
        <td>
          <span style="font-family: monospace; font-size: 0.85rem; font-weight: 800; background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px;">
            ${b.token_code}
          </span>
        </td>
        <td style="font-size: 0.75rem; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${itemsList}">
          ${itemsList}
        </td>
        <td style="font-weight: 700; color: #1e3a8a;">₹${b.total_amount.toFixed(2)}</td>
        <td>
          <span style="background:${isCollected ? '#dcfce7' : '#fef3c7'}; color:${isCollected ? '#15803d' : '#854d0e'}; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px;">
            ${b.status}
          </span>
          ${!isCollected ? `<button onclick="collectMealToken('${b.id}')" style="margin-left:4px; font-size:10px; padding:2px 5px; cursor:pointer; background:#059669; color:white; border:none; border-radius:3px;" title="Canteen Staff Pickup">Collect</button>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load meal bookings:', err);
  }
}

async function collectMealToken(bookingId) {
  try {
    const res = await fetch(`/api/meal-bookings/collect/${bookingId}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to collect', 'error');
      return;
    }
    showToast(data.message || 'Meal marked as collected!', 'success');
    if (currentActiveStudent) loadPrebookHistory(currentActiveStudent.id);
  } catch (err) {
    showToast('Error marking collected', 'error');
  }
}

// -------------------------------------------------------------
// TOP-UP & RAZORPAY SANDBOX
// -------------------------------------------------------------
function setAmount(val) {
  document.getElementById('topup-amount').value = val;
}

function handleTopUp(e) {
  e.preventDefault();
  if (!currentActiveStudent) {
    showToast('No active student selected', 'error');
    return;
  }

  const amount = parseFloat(document.getElementById('topup-amount').value);
  if (!amount || amount <= 0) {
    showToast('Please enter a valid amount', 'error');
    return;
  }

  pendingTopupData = {
    studentId: currentActiveStudent.id,
    admissionNumber: currentActiveStudent.admission_number,
    amount,
    studentName: currentActiveStudent.name,
    parentName: currentActiveStudent.parent_name,
    isPrebookingDirect: false
  };

  document.getElementById('rzp-modal-amount').innerText = `₹${amount.toFixed(2)}`;
  document.getElementById('rzp-modal-desc').innerText = `DPS Indirapuram • ${currentActiveStudent.name} (${currentActiveStudent.admission_number})`;
  document.getElementById('razorpay-modal-overlay').classList.add('active');
}

function closeRazorpayModal() {
  document.getElementById('razorpay-modal-overlay').classList.remove('active');
}

async function simulatePayment(method) {
  if (!pendingTopupData) return;

  const methodName = method === 'UPI_GPAY' ? 'Razorpay UPI (Google Pay)' :
                     method === 'CARD_VISA' ? 'Razorpay Card (Visa Ending 4242)' :
                     'Razorpay NetBanking (HDFC Bank)';

  showToast(`Processing payment via Razorpay Sandbox...`, 'info');
  closeRazorpayModal();

  try {
    // 1. Top-up wallet first
    const res = await fetch('/api/wallet/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: pendingTopupData.studentId,
        amount: pendingTopupData.amount,
        paymentMethod: methodName,
        idempotencyKey: 'rzp_' + Date.now(),
        parentName: pendingTopupData.parentName
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Top-up failed', 'error');
      return;
    }

    // 2. If this was initiated from Direct Prebooking, immediately execute prebooking
    if (pendingTopupData.isPrebookingDirect && pendingTopupData.bookingPayload) {
      showToast(`Razorpay payment approved! Confirming meal pre-booking...`, 'info');
      const bookRes = await fetch('/api/meal-bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingTopupData.bookingPayload)
      });
      const bookData = await bookRes.json();
      if (bookRes.ok) {
        showToast(`🎉 Meal booked for ${bookData.bookingDate}! Token Code: ${bookData.tokenCode}`, 'success');
        clearPrebookTray();
        document.getElementById('prebook-notes').value = '';
      }
    } else {
      showToast(`Payment Verified! ₹${pendingTopupData.amount} added to ${pendingTopupData.studentName}'s wallet`, 'success');
      const amtInput = document.getElementById('topup-amount');
      if (amtInput) amtInput.value = '';
    }

    // Reload active student to refresh balance
    await handleStudentChange(pendingTopupData.admissionNumber);
    if (currentActiveStudent) loadPrebookHistory(currentActiveStudent.id);

  } catch (err) {
    console.error(err);
    showToast('Network error during transaction', 'error');
  }
}

// -------------------------------------------------------------
// CANTEEN POS MENU & ORDER
// -------------------------------------------------------------
async function loadMenu() {
  try {
    const res = await fetch('/api/menu');
    const data = await res.json();
    menuCatalog = data.items || [];

    // 1. Populate POS menu grid
    const posGrid = document.getElementById('pos-menu-grid');
    if (posGrid) {
      posGrid.innerHTML = '';
      menuCatalog.forEach(item => {
        const card = document.createElement('div');
        card.className = 'menu-item-box';
        card.onclick = () => addToCart(item);
        card.innerHTML = `
          <div style="font-size: 2rem; margin-bottom: 4px;">${item.image_emoji}</div>
          <div style="font-size: 0.82rem; font-weight: 700;">${item.name}</div>
          <div style="font-size: 0.95rem; font-weight: 800; color: #1e3a8a; margin-top: 2px;">₹${item.price.toFixed(2)}</div>
        `;
        posGrid.appendChild(card);
      });
    }

    // 2. Populate Pre-Booking menu grid
    const prebookGrid = document.getElementById('prebook-menu-grid');
    if (prebookGrid) {
      prebookGrid.innerHTML = '';
      menuCatalog.forEach(item => {
        const card = document.createElement('div');
        card.className = 'menu-item-box';
        card.onclick = () => addToPrebookTray(item);
        card.innerHTML = `
          <div style="font-size: 1.8rem; margin-bottom: 4px;">${item.image_emoji}</div>
          <div style="font-size: 0.8rem; font-weight: 700;">${item.name}</div>
          <span style="font-size: 0.68rem; color: #64748b;">${item.category}</span>
          <div style="font-size: 0.92rem; font-weight: 800; color: #1e3a8a; margin-top: 2px;">₹${item.price.toFixed(2)}</div>
        `;
        prebookGrid.appendChild(card);
      });
    }

  } catch (err) {
    console.error('Failed to load menu:', err);
  }
}

function addToCart(item) {
  const existing = cart.find(c => c.id === item.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ ...item, quantity: 1 });
  }
  renderCart();
}

function updateCartQty(itemId, delta) {
  const idx = cart.findIndex(c => c.id === itemId);
  if (idx !== -1) {
    cart[idx].quantity += delta;
    if (cart[idx].quantity <= 0) {
      cart.splice(idx, 1);
    }
  }
  renderCart();
}

function clearCart() {
  cart = [];
  renderCart();
}

function renderCart() {
  const tbody = document.getElementById('cart-tbody');
  tbody.innerHTML = '';

  if (cart.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #94a3b8;">Tray is empty</td></tr>`;
    document.getElementById('cart-total-amount').innerText = '₹0.00';
    document.getElementById('pos-charge-btn').disabled = true;
    return;
  }

  let totalAmount = 0;

  cart.forEach(item => {
    const itemTotal = item.price * item.quantity;
    totalAmount += itemTotal;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${item.name}</strong></td>
      <td>
        <button onclick="updateCartQty('${item.id}', -1)" style="padding: 1px 5px; border:1px solid #cbd5e1; background:#f8fafc; cursor:pointer;">-</button>
        <span style="margin: 0 4px; font-weight:700;">${item.quantity}</span>
        <button onclick="updateCartQty('${item.id}', 1)" style="padding: 1px 5px; border:1px solid #cbd5e1; background:#f8fafc; cursor:pointer;">+</button>
      </td>
      <td style="font-weight:700; color: #1e3a8a;">₹${itemTotal.toFixed(2)}</td>
      <td><button onclick="updateCartQty('${item.id}', -${item.quantity})" style="color:#ef4444; background:none; border:none; cursor:pointer; font-weight:bold;">&times;</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('cart-total-amount').innerText = `₹${totalAmount.toFixed(2)}`;
  document.getElementById('pos-charge-btn').disabled = !(currentActiveStudent && totalAmount > 0);
}

async function processPOSOrder() {
  if (!currentActiveStudent) {
    showToast('No active student selected', 'error');
    return;
  }
  if (cart.length === 0) {
    showToast('Tray is empty!', 'error');
    return;
  }

  const payload = {
    admissionNumber: currentActiveStudent.admission_number,
    items: cart.map(item => ({ id: item.id, name: item.name, quantity: item.quantity })),
    staffId: 'POS-STAFF-1',
    staffName: 'DPS Indirapuram Staff'
  };

  try {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Order failed', 'error');
      return;
    }

    showToast(`Meal Issued! ₹${data.totalAmount.toFixed(2)} deducted from ${currentActiveStudent.name}'s wallet`, 'success');
    clearCart();

    handleStudentChange(currentActiveStudent.admission_number);
  } catch (err) {
    console.error(err);
    showToast('Network error during order checkout', 'error');
  }
}

// -------------------------------------------------------------
// RESET TEST MODE CONTROLS
// -------------------------------------------------------------
function promptResetTestMode() {
  const modal = document.getElementById('reset-modal-overlay');
  if (modal) {
    modal.style.display = 'flex';
  }
}

function closeResetModal() {
  const modal = document.getElementById('reset-modal-overlay');
  if (modal) {
    modal.style.display = 'none';
  }
}

async function executeResetTestMode() {
  closeResetModal();
  showToast('Resetting test data to factory defaults...', 'info');

  try {
    const res = await fetch('/api/reset-demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to reset test mode', 'error');
      return;
    }

    showToast('✨ Factory reset complete! All test wallets & balances restored.', 'success');

    // Clear local shopping trays
    clearCart();
    clearPrebookTray();

    // Refresh students and set back to first student
    await loadStudents();

    // Reload active student state & prebook history
    if (allStudents && allStudents.length > 0) {
      const topStudent = allStudents[0];
      await handleStudentChange(topStudent.admission_number);
      if (typeof loadPrebookHistory === 'function') {
        loadPrebookHistory(topStudent.id);
      }
    }
  } catch (err) {
    console.error('Reset test mode error:', err);
    showToast('Network error during demo reset', 'error');
  }
}

// Init on ready
window.addEventListener('DOMContentLoaded', () => {
  loadStudents();
  loadMenu();

  // Initialize pre-booking date to Tomorrow by default
  const dateInput = document.getElementById('prebook-date');
  if (dateInput) {
    dateInput.value = getFormattedDate(1);
    dateInput.min = getFormattedDate(0);
  }
});
