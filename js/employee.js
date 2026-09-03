/**
 * 员工端 - 领取登记前端逻辑（云端部署版）
 * 使用 db.js 提供的 Supabase 封装函数替代 fetch API
 */

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    loadDepartments();
    loadInventory();
    loadBorrowDepartments();
    loadBorrowItems();
    loadPurchaseDepartments();

    // 领取表单提交
    document.getElementById('request-form').addEventListener('submit', handleSubmit);

    // 借用表单提交
    document.getElementById('borrow-form').addEventListener('submit', handleBorrowSubmit);

    // 采购表单提交
    document.getElementById('purchase-form').addEventListener('submit', handlePurchaseSubmit);

    // 回车查询
    document.getElementById('search-name').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') loadMyRequests();
    });
    document.getElementById('search-borrower').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') loadMyBorrows();
    });
    document.getElementById('search-purchase-name').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') loadMyPurchaseRequests();
    });

    // 自动填充姓名（从上次输入）
    const savedName = localStorage.getItem('stationery_requester');
    if (savedName) {
        document.getElementById('requester').value = savedName;
        document.getElementById('search-name').value = savedName;
        document.getElementById('borrower').value = savedName;
        document.getElementById('search-borrower').value = savedName;
        document.getElementById('purchase-requester').value = savedName;
        document.getElementById('search-purchase-name').value = savedName;
        loadMyRequests();
    }
});

// 模式切换
function switchMode(mode) {
    // 移除所有 active
    document.getElementById('tab-request').classList.remove('active');
    document.getElementById('tab-borrow').classList.remove('active');
    document.getElementById('tab-purchase').classList.remove('active');
    // 隐藏所有 section
    document.getElementById('section-request').style.display = 'none';
    document.getElementById('section-borrow').style.display = 'none';
    document.getElementById('section-purchase').style.display = 'none';

    if (mode === 'request') {
        document.getElementById('tab-request').classList.add('active');
        document.getElementById('section-request').style.display = 'block';
    } else if (mode === 'borrow') {
        document.getElementById('tab-borrow').classList.add('active');
        document.getElementById('section-borrow').style.display = 'block';
    } else if (mode === 'purchase') {
        document.getElementById('tab-purchase').classList.add('active');
        document.getElementById('section-purchase').style.display = 'block';
    }
}

// 加载部门列表
async function loadDepartments() {
    try {
        const depts = await getDepartments();
        const select = document.getElementById('department');
        depts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error('加载部门失败:', err);
    }
}

// 全局保存物品列表，用于搜索过滤
let allInventoryItems = [];

// 加载物品列表
async function loadInventory() {
    try {
        const items = await getInventory();
        allInventoryItems = items; // 保存到全局变量
        const select = document.getElementById('item_code');

        if (items.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '暂无可用物品，请联系管理员添加';
            opt.disabled = true;
            select.appendChild(opt);
            return;
        }

        // 按类别分组
        const grouped = {};
        items.forEach(item => {
            if (!grouped[item.category]) grouped[item.category] = [];
            grouped[item.category].push(item);
        });

        renderItemOptions(grouped);
    } catch (err) {
        console.error('加载物品失败:', err);
    }
}

// 渲染物品选项（按类别分组）
function renderItemOptions(grouped) {
    const select = document.getElementById('item_code');
    select.innerHTML = '<option value="">请选择物品</option>';

    Object.keys(grouped).forEach(cat => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = cat;
        grouped[cat].forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.code;
            opt.textContent = `${item.name} (${item.unit})`;
            optgroup.appendChild(opt);
        });
        select.appendChild(optgroup);
    });
}

// 搜索过滤物品
function filterItems(keyword) {
    keyword = keyword.trim().toLowerCase();
    if (!keyword) {
        // 关键词为空，显示全部
        const grouped = {};
        allInventoryItems.forEach(item => {
            if (!grouped[item.category]) grouped[item.category] = [];
            grouped[item.category].push(item);
        });
        renderItemOptions(grouped);
        return;
    }

    // 过滤匹配的物品（名称或编号包含关键词）
    const filtered = allInventoryItems.filter(item =>
        item.name.toLowerCase().includes(keyword) ||
        item.code.toLowerCase().includes(keyword) ||
        (item.category && item.category.toLowerCase().includes(keyword))
    );

    const select = document.getElementById('item_code');
    if (filtered.length === 0) {
        select.innerHTML = '<option value="">未找到匹配物品，可去"需求采购"申请</option>';
        return;
    }

    // 搜索结果不分组，直接列出
    select.innerHTML = '<option value="">请选择物品</option>';
    filtered.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.code;
        opt.textContent = `${item.name} (${item.unit}) [${item.category || '未分类'}]`;
        select.appendChild(opt);
    });
}

// 提交领取申请
async function handleSubmit(e) {
    e.preventDefault();

    const data = {
        department: document.getElementById('department').value,
        requester: document.getElementById('requester').value.trim(),
        item_code: document.getElementById('item_code').value,
        quantity: parseInt(document.getElementById('quantity').value),
        notes: document.getElementById('notes').value.trim()
    };

    try {
        const result = await submitRequest(data);

        if (result.success) {
            showToast('领取申请已提交成功！', 'success');
            // 保存姓名
            localStorage.setItem('stationery_requester', data.requester);
            // 重置表单（保留姓名和部门）
            document.getElementById('item_code').value = '';
            document.getElementById('quantity').value = '1';
            document.getElementById('notes').value = '';
            // 刷新我的记录
            document.getElementById('search-name').value = data.requester;
            loadMyRequests();
        } else {
            showToast(result.error || '提交失败，请重试', 'error');
        }
    } catch (err) {
        showToast('网络错误，请重试', 'error');
    }
}

// 加载我的领取记录
async function loadMyRequests() {
    const name = document.getElementById('search-name').value.trim();
    if (!name) {
        showToast('请输入姓名', 'error');
        return;
    }

    const container = document.getElementById('my-records');
    container.innerHTML = '<div class="loading">加载中</div>';

    try {
        const records = await getMyRequests(name);

        if (records.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div>暂无领取记录</div>
                </div>`;
            return;
        }

        let html = `
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>日期</th>
                            <th>部门</th>
                            <th>物品名称</th>
                            <th class="text-center">数量</th>
                            <th class="text-center">状态</th>
                        </tr>
                    </thead>
                    <tbody>`;

        records.forEach(r => {
            const statusTag = getStatusTag(r.status);
            html += `
                <tr>
                    <td>${r.req_date}</td>
                    <td>${r.department}</td>
                    <td>${r.item_name}</td>
                    <td class="text-center">${r.quantity}</td>
                    <td class="text-center">${statusTag}</td>
                </tr>`;
        });

        // 汇总
        const totalQty = records.reduce((sum, r) => sum + r.quantity, 0);
        html += `
                    </tbody>
                    <tfoot>
                        <tr style="font-weight:700; background:var(--primary-light);">
                            <td colspan="3">合计</td>
                            <td class="text-center">${totalQty}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>`;

        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<div class="alert alert-error">加载失败，请重试</div>';
    }
}

// 状态标签
function getStatusTag(status) {
    const map = {
        '待审核': '<span class="tag tag-pending">待审核</span>',
        '已发放': '<span class="tag tag-approved">已发放</span>',
        '已拒绝': '<span class="tag tag-rejected">已拒绝</span>'
    };
    return map[status] || status;
}

// Toast 提示
function showToast(message, type) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}


// ============================================================
// 物品借用
// ============================================================

// 加载借用部门列表
async function loadBorrowDepartments() {
    try {
        const depts = await getDepartments();
        const select = document.getElementById('borrow-department');
        depts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error('加载部门失败:', err);
    }
}

// 加载可借用物品列表
async function loadBorrowItems() {
    try {
        const items = await getBorrowItems();
        const select = document.getElementById('borrow-item');

        if (items.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '暂无可借用物品，请联系管理员添加';
            opt.disabled = true;
            select.appendChild(opt);
            return;
        }

        // 按类别分组
        const grouped = {};
        items.forEach(item => {
            if (!grouped[item.category]) grouped[item.category] = [];
            grouped[item.category].push(item);
        });

        Object.keys(grouped).forEach(cat => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = cat;
            grouped[cat].forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.id;
                opt.textContent = `${item.name} (可借${item.available_qty}/${item.total_qty})`;
                if (item.available_qty === 0) opt.disabled = true;
                optgroup.appendChild(opt);
            });
            select.appendChild(optgroup);
        });
    } catch (err) {
        console.error('加载借用物品失败:', err);
    }
}

// 提交借用申请
async function handleBorrowSubmit(e) {
    e.preventDefault();

    const data = {
        department: document.getElementById('borrow-department').value,
        borrower: document.getElementById('borrower').value.trim(),
        item_id: parseInt(document.getElementById('borrow-item').value),
        quantity: parseInt(document.getElementById('borrow-qty').value),
        notes: document.getElementById('borrow-notes').value.trim()
    };

    try {
        const result = await submitBorrow(data);

        if (result.success) {
            showToast('借用申请已提交成功！', 'success');
            localStorage.setItem('stationery_requester', data.borrower);
            document.getElementById('borrow-item').value = '';
            document.getElementById('borrow-qty').value = '1';
            document.getElementById('borrow-notes').value = '';
            document.getElementById('search-borrower').value = data.borrower;
            loadMyBorrows();
            loadBorrowItems(); // 刷新可借数量
        } else {
            showToast(result.error || '提交失败，请重试', 'error');
        }
    } catch (err) {
        showToast('网络错误，请重试', 'error');
    }
}

// 加载我的借用记录
async function loadMyBorrows() {
    const name = document.getElementById('search-borrower').value.trim();
    if (!name) {
        showToast('请输入姓名', 'error');
        return;
    }

    const container = document.getElementById('my-borrows');
    container.innerHTML = '<div class="loading">加载中</div>';

    try {
        const records = await getMyBorrows(name);

        if (records.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div>暂无借用记录</div>
                </div>`;
            return;
        }

        let html = `
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>借出日期</th>
                            <th>部门</th>
                            <th>物品名称</th>
                            <th class="text-center">数量</th>
                            <th class="text-center">状态</th>
                            <th>归还日期</th>
                        </tr>
                    </thead>
                    <tbody>`;

        records.forEach(r => {
            const statusTag = r.status === '借出中'
                ? '<span class="tag tag-pending">借出中</span>'
                : '<span class="tag tag-approved">已归还</span>';
            html += `
                <tr>
                    <td>${r.borrow_date}</td>
                    <td>${r.department}</td>
                    <td>${r.item_name}</td>
                    <td class="text-center">${r.quantity}</td>
                    <td class="text-center">${statusTag}</td>
                    <td>${r.return_date || '-'}</td>
                </tr>`;
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<div class="alert alert-error">加载失败，请重试</div>';
    }
}


// ============================================================
// 需求采购
// ============================================================

// 加载采购部门列表
async function loadPurchaseDepartments() {
    try {
        const depts = await getDepartments();
        const select = document.getElementById('purchase-department');
        depts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error('加载部门失败:', err);
    }
}

// 提交采购申请
async function handlePurchaseSubmit(e) {
    e.preventDefault();

    const data = {
        department: document.getElementById('purchase-department').value,
        requester: document.getElementById('purchase-requester').value.trim(),
        item_name: document.getElementById('purchase-item-name').value.trim(),
        category: document.getElementById('purchase-category').value.trim(),
        quantity: parseInt(document.getElementById('purchase-qty').value),
        unit: document.getElementById('purchase-unit').value.trim(),
        estimated_price: document.getElementById('purchase-price').value,
        reason: document.getElementById('purchase-reason').value.trim(),
        notes: document.getElementById('purchase-notes').value.trim()
    };

    if (!data.department || !data.requester || !data.item_name || !data.quantity || !data.reason) {
        document.getElementById('purchase-alert').innerHTML =
            '<div class="alert alert-error">❌ 请填写所有必填项</div>';
        return;
    }

    try {
        const result = await submitPurchaseRequest(data);

        if (result.success) {
            showToast('采购申请已提交成功！', 'success');
            localStorage.setItem('stationery_requester', data.requester);
            // 重置表单（保留部门和姓名）
            document.getElementById('purchase-item-name').value = '';
            document.getElementById('purchase-category').value = '';
            document.getElementById('purchase-qty').value = '1';
            document.getElementById('purchase-unit').value = '';
            document.getElementById('purchase-price').value = '';
            document.getElementById('purchase-reason').value = '';
            document.getElementById('purchase-notes').value = '';
            document.getElementById('purchase-alert').innerHTML = '';
            // 刷新我的记录
            document.getElementById('search-purchase-name').value = data.requester;
            loadMyPurchaseRequests();
        } else {
            document.getElementById('purchase-alert').innerHTML =
                `<div class="alert alert-error">❌ ${result.error || '提交失败，请重试'}</div>`;
        }
    } catch (err) {
        document.getElementById('purchase-alert').innerHTML =
            '<div class="alert alert-error">❌ 网络错误，请重试</div>';
    }
}

// 加载我的采购申请
async function loadMyPurchaseRequests() {
    const name = document.getElementById('search-purchase-name').value.trim();
    if (!name) {
        showToast('请输入姓名', 'error');
        return;
    }

    const container = document.getElementById('my-purchase-records');
    container.innerHTML = '<div class="loading">加载中</div>';

    try {
        const records = await getMyPurchaseRequests(name);

        if (records.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div>暂无采购申请</div>
                </div>`;
            return;
        }

        let html = `
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>申请日期</th>
                            <th>部门</th>
                            <th>物品名称</th>
                            <th class="text-center">数量</th>
                            <th>单位</th>
                            <th class="text-center">状态</th>
                            <th>备注</th>
                        </tr>
                    </thead>
                    <tbody>`;

        records.forEach(r => {
            const statusTag = getPurchaseStatusTag(r.status);
            html += `
                <tr>
                    <td>${r.req_date}</td>
                    <td>${r.department}</td>
                    <td><strong>${r.item_name}</strong></td>
                    <td class="text-center">${r.quantity}</td>
                    <td>${r.unit || '-'}</td>
                    <td class="text-center">${statusTag}</td>
                    <td>${r.notes || '-'}</td>
                </tr>`;
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<div class="alert alert-error">加载失败，请重试</div>';
    }
}

// 采购状态标签
function getPurchaseStatusTag(status) {
    const map = {
        '待采购': '<span class="tag tag-pending">待采购</span>',
        '已采购': '<span class="tag tag-approved">已采购</span>',
        '已拒绝': '<span class="tag tag-rejected">已拒绝</span>'
    };
    return map[status] || status;
}
