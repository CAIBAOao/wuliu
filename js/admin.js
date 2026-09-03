/**
 * 管理员后台 - 前端逻辑（云端部署版）
 * 使用 db.js 提供的 Supabase 封装函数替代 fetch API
 */

// ============================================================
// 保存 db.js 中同名函数的引用
// 使用 window.* 显式引用，避免作用域问题
// ============================================================
let _dbUpdateInventory, _dbReturnBorrow, _dbUpdateBorrowItem, _dbDeleteBorrowItem, _dbAddBorrowItem;

try {
    _dbUpdateInventory = window.updateInventory;
    _dbReturnBorrow = window.returnBorrow;
    _dbUpdateBorrowItem = window.updateBorrowItem;
    _dbDeleteBorrowItem = window.deleteBorrowItem;
    _dbAddBorrowItem = window.addBorrowItem;
} catch(e) {
    console.error('Failed to load db.js functions:', e);
}

let isLoggedIn = false;
let inventoryData = [];

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    try {
        // 检查登录状态（同步，从 localStorage 读取）
        if (typeof adminCheck === 'function' && adminCheck()) {
            showAdminPage();
        } else {
            showLoginPage();
        }
    } catch(e) {
        console.error('Init error:', e);
        // 出错时确保登录页可见
        var lp = document.getElementById('login-page');
        if (lp) lp.style.display = 'block';
    }

    // 登录表单 - 不再重复绑定，HTML中已用 onsubmit 内联处理
    // 筛选事件（安全绑定）
    function safeBind(id, event, handler) {
        var el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
        else console.warn('Element not found:', id);
    }
    safeBind('filter-dept', 'change', loadRequests);
    safeBind('filter-item', 'change', loadRequests);
    safeBind('filter-status', 'change', loadRequests);
    safeBind('borrow-filter-dept', 'change', loadBorrowRecords);
    safeBind('borrow-filter-status', 'change', loadBorrowRecords);
});

// 点击遮罩层关闭弹窗
document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('add-item-modal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) closeAddItemModal();
        });
    }
    const borrowModal = document.getElementById('add-borrow-item-modal');
    if (borrowModal) {
        borrowModal.addEventListener('click', function(e) {
            if (e.target === borrowModal) closeAddBorrowItemModal();
        });
    }
    const stockinModal = document.getElementById('add-stockin-modal');
    if (stockinModal) {
        stockinModal.addEventListener('click', function(e) {
            if (e.target === stockinModal) closeAddStockInModal();
        });
    }
});

// 显示登录页
function showLoginPage() {
    document.getElementById('login-page').style.display = 'block';
    document.getElementById('admin-page').style.display = 'none';
}

// 显示管理后台
function showAdminPage() {
    isLoggedIn = true;
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('admin-page').style.display = 'block';
    loadDashboard();
    loadFilters();
    // 启动通知轮询
    startNotificationPolling();
}
// 暴露到 window，供内联登录调用
window.showAdminPage = showAdminPage;
window.showToast = showToast;

// 登录（同步，使用 adminLogin）
function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    const data = adminLogin(username, password);

    if (data.success) {
        showAdminPage();
        showToast('登录成功', 'success');
    } else {
        const alertDiv = document.getElementById('login-alert');
        alertDiv.innerHTML = `<div class="alert alert-error">❌ ${data.error || '登录失败'}</div>`;
    }
}

// 退出（同步，使用 adminLogout）
function logout(e) {
    e.preventDefault();
    adminLogout();
    isLoggedIn = false;
    stopNotificationPolling();
    showLoginPage();
}

// 切换标签页
function switchTab(tab, e) {
    e.preventDefault();
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));

    document.getElementById('tab-dashboard').style.display = 'none';
    document.getElementById('tab-requests').style.display = 'none';
    document.getElementById('tab-stockin').style.display = 'none';
    document.getElementById('tab-inventory').style.display = 'none';
    document.getElementById('tab-category').style.display = 'none';
    document.getElementById('tab-borrow').style.display = 'none';
    document.getElementById('tab-purchase').style.display = 'none';
    document.getElementById('tab-stats').style.display = 'none';

    document.getElementById('tab-' + tab).style.display = 'block';
    e.target.classList.add('active');

    // 切换到非库存管理页面时，清除预警筛选
    if (tab !== 'inventory') {
        _filterLowStock = false;
    }

    if (tab === 'dashboard') loadDashboard();
    else if (tab === 'requests') loadRequests();
    else if (tab === 'stockin') loadStockIn();
    else if (tab === 'inventory') loadInventory();
    else if (tab === 'category') loadCategoryPage();
    else if (tab === 'borrow') loadBorrowPage();
    else if (tab === 'purchase') loadPurchasePage();
    else if (tab === 'stats') loadStats();
}

// 加载筛选器选项
async function loadFilters() {
    try {
        const [depts, items] = await Promise.all([
            getDepartments(),
            getInventory()
        ]);

        const deptSelect = document.getElementById('filter-dept');
        depts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            deptSelect.appendChild(opt);
        });

        const itemSelect = document.getElementById('filter-item');
        items.forEach(i => {
            const opt = document.createElement('option');
            opt.value = i.code;
            opt.textContent = i.name;
            itemSelect.appendChild(opt);
        });

        // 借用筛选器部门
        const borrowDeptSelect = document.getElementById('borrow-filter-dept');
        if (borrowDeptSelect && borrowDeptSelect.children.length <= 1) {
            depts.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d;
                opt.textContent = d;
                borrowDeptSelect.appendChild(opt);
            });
        }

        // 入库筛选器物品
        const stockinItemSelect = document.getElementById('stockin-filter-item');
        if (stockinItemSelect && stockinItemSelect.children.length <= 1) {
            items.forEach(i => {
                const opt = document.createElement('option');
                opt.value = i.code;
                opt.textContent = i.name;
                stockinItemSelect.appendChild(opt);
            });
        }

        // 采购筛选器部门
        const purchaseDeptSelect = document.getElementById('purchase-filter-dept');
        if (purchaseDeptSelect && purchaseDeptSelect.children.length <= 1) {
            depts.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d;
                opt.textContent = d;
                purchaseDeptSelect.appendChild(opt);
            });
        }
    } catch (err) {
        console.error('加载筛选器失败:', err);
        showToast('筛选器加载失败: ' + (err.message || err), 'error');
    }
}

// 加载仪表盘
async function loadDashboard() {
    try {
        const data = await getAdminStats();

        // 统计卡片
        const s = data.summary;
        document.getElementById('stats-grid').innerHTML = `
            <div class="stat-card">
                <div class="stat-icon">📋</div>
                <div class="stat-label">总领取次数</div>
                <div class="stat-value">${s.total_requests}</div>
            </div>
            <div class="stat-card success">
                <div class="stat-icon">📦</div>
                <div class="stat-label">总领取数量</div>
                <div class="stat-value">${s.total_qty}</div>
            </div>
            <div class="stat-card warning">
                <div class="stat-icon">⏳</div>
                <div class="stat-label">待审核申请</div>
                <div class="stat-value">${s.pending}</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">🏷️</div>
                <div class="stat-label">物品种类</div>
                <div class="stat-value">${s.total_items}</div>
            </div>
            <div class="stat-card danger" onclick="showLowStockItems()" style="cursor:pointer; transition:transform 0.2s;" onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'">
                <div class="stat-icon">⚠️</div>
                <div class="stat-label">库存预警（点击查看）</div>
                <div class="stat-value">${s.low_stock}</div>
            </div>
        `;

        // 部门统计表
        const totalQty = data.departments.reduce((sum, d) => sum + d.total_qty, 0) || 1;
        let deptHtml = `
            <table>
                <thead>
                    <tr>
                        <th>部门</th>
                        <th class="text-center">领取次数</th>
                        <th class="text-center">领取数量</th>
                        <th class="text-center">占比</th>
                        <th>可视化</th>
                    </tr>
                </thead>
                <tbody>`;
        if (data.departments.length === 0) {
            deptHtml += '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">暂无领取记录</td></tr>';
        }
        data.departments.forEach(d => {
            const pct = (d.total_qty / totalQty * 100).toFixed(1);
            const barWidth = Math.min(d.total_qty / totalQty * 100, 100);
            deptHtml += `
                <tr>
                    <td><strong>${d.department}</strong></td>
                    <td class="text-center">${d.req_count}</td>
                    <td class="text-center">${d.total_qty}</td>
                    <td class="text-center">${pct}%</td>
                    <td>
                        <div style="background:var(--primary-light); border-radius:4px; height:20px; width:100%; overflow:hidden;">
                            <div style="background:var(--primary); height:100%; width:${barWidth}%; border-radius:4px; transition:width 0.5s;"></div>
                        </div>
                    </td>
                </tr>`;
        });
        deptHtml += '</tbody></table>';
        document.getElementById('dept-chart').innerHTML = deptHtml;

        // 类别统计表
        let catHtml = `
            <table>
                <thead>
                    <tr>
                        <th>类别</th>
                        <th class="text-center">采购总量</th>
                        <th class="text-center">已领取量</th>
                        <th class="text-center">剩余库存</th>
                        <th>使用率</th>
                    </tr>
                </thead>
                <tbody>`;
        if (data.categories.length === 0) {
            catHtml += '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">暂无库存数据</td></tr>';
        }
        data.categories.forEach(c => {
            const remaining = c.purchase_total - c.claimed_total;
            const usageRate = c.purchase_total > 0 ? (c.claimed_total / c.purchase_total * 100).toFixed(1) : 0;
            const barColor = usageRate > 80 ? '#f44336' : usageRate > 50 ? '#FF9800' : '#4CAF50';
            catHtml += `
                <tr>
                    <td><strong>${c.category}</strong></td>
                    <td class="text-center">${c.purchase_total}</td>
                    <td class="text-center">${c.claimed_total}</td>
                    <td class="text-center">${remaining}</td>
                    <td>
                        <div style="background:var(--primary-light); border-radius:4px; height:20px; width:100%; overflow:hidden;">
                            <div style="background:${barColor}; height:100%; width:${usageRate}%; border-radius:4px; transition:width 0.5s;"></div>
                        </div>
                        <span style="font-size:12px; color:var(--text-muted);">${usageRate}%</span>
                    </td>
                </tr>`;
        });
        catHtml += '</tbody></table>';
        document.getElementById('cat-chart').innerHTML = catHtml;

    } catch (err) {
        console.error('加载仪表盘失败:', err);
        document.getElementById('stats-grid').innerHTML =
            '<div class="alert alert-error" style="grid-column:1/-1;">❌ 数据加载失败：' + (err.message || err) + '</div>';
    }
}

// 加载领取记录
async function loadRequests() {
    const container = document.getElementById('requests-table');
    container.innerHTML = '<div class="loading">加载中</div>';

    // 构建 filters 对象
    const filters = {};
    const dept = document.getElementById('filter-dept').value;
    const item = document.getElementById('filter-item').value;
    const status = document.getElementById('filter-status').value;
    const dateFrom = document.getElementById('filter-date-from').value;
    const dateTo = document.getElementById('filter-date-to').value;

    if (dept) filters.department = dept;
    if (item) filters.item_code = item;
    if (status) filters.status = status;
    if (dateFrom) filters.date_from = dateFrom;
    if (dateTo) filters.date_to = dateTo;

    try {
        const records = await getAdminRequests(filters);

        if (records.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div>暂无符合条件的记录</div>
                </div>`;
            return;
        }

        let html = `
            <table>
                <thead>
                    <tr>
                        <th class="text-center">序号</th>
                        <th>日期</th>
                        <th>部门</th>
                        <th>物品编号</th>
                        <th>物品名称</th>
                        <th class="text-center">数量</th>
                        <th>领取人</th>
                        <th class="text-center">状态</th>
                        <th>备注</th>
                        <th class="text-center">操作</th>
                    </tr>
                </thead>
                <tbody>`;

        let totalQty = 0;
        records.forEach((r, i) => {
            totalQty += r.quantity;
            const statusTag = getStatusTag(r.status);
            const actions = r.status === '待审核'
                ? `<button class="btn btn-success btn-sm" onclick="updateStatus(${r.id}, '已发放')">通过</button>
                   <button class="btn btn-danger btn-sm" onclick="updateStatus(${r.id}, '已拒绝')">拒绝</button>`
                : `<span style="color:var(--text-muted); font-size:12px;">已处理</span>`;
            html += `
                <tr>
                    <td class="text-center">${i + 1}</td>
                    <td>${r.req_date}</td>
                    <td>${r.department}</td>
                    <td>${r.item_code}</td>
                    <td>${r.item_name}</td>
                    <td class="text-center">${r.quantity}</td>
                    <td>${r.requester}</td>
                    <td class="text-center">${statusTag}</td>
                    <td>${r.notes || '-'}</td>
                    <td class="text-center" style="white-space:nowrap;">${actions}</td>
                </tr>`;
        });

        html += `
                </tbody>
                <tfoot>
                    <tr style="font-weight:700; background:var(--primary-light);">
                        <td colspan="5">合计 ${records.length} 条记录</td>
                        <td class="text-center">${totalQty}</td>
                        <td colspan="4"></td>
                    </tr>
                </tfoot>
            </table>`;

        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<div class="alert alert-error">加载失败</div>';
    }
}

// 更新状态
async function updateStatus(id, status) {
    try {
        const data = await updateRequestStatus(id, status);
        if (data.success) {
            showToast(`已${status === '已发放' ? '通过' : '拒绝'}申请`, 'success');
            loadRequests();
        } else {
            showToast('操作失败', 'error');
        }
    } catch {
        showToast('网络错误', 'error');
    }
}

// 加载库存管理
async function loadInventory() {
    const container = document.getElementById('inventory-table');
    container.innerHTML = '<div class="loading">加载中</div>';

    try {
        inventoryData = await getAdminInventory();

        // 如果开启了预警筛选，只显示库存不足的物品
        let displayData = inventoryData;
        let filterBanner = '';
        if (_filterLowStock) {
            displayData = inventoryData.filter(item => item.remaining <= item.safety_stock);
            filterBanner = `
                <div style="background:#FFF3E0; border:1px solid #FFB74D; border-radius:8px; padding:12px 16px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="color:#E65100; font-weight:600;">⚠️ 库存预警筛选</span>
                        <span style="color:#5D4037; margin-left:12px; font-size:13px;">当前显示 ${displayData.length} 种库存不足的物品（剩余库存 ≤ 安全库存）</span>
                    </div>
                    <button class="btn btn-outline btn-sm" onclick="clearLowStockFilter()">✕ 显示全部物品</button>
                </div>`;
        }

        let html = filterBanner + `
            <table>
                <thead>
                    <tr>
                        <th>编号</th>
                        <th>物品名称</th>
                        <th>类别</th>
                        <th class="text-center">单位</th>
                        <th class="text-center">采购数量</th>
                        <th class="text-center">已领取量</th>
                        <th class="text-center">剩余库存</th>
                        <th class="text-center">安全库存</th>
                        <th class="text-center">状态</th>
                        <th class="text-center">操作</th>
                    </tr>
                </thead>
                <tbody>`;

        let totalPurchase = 0, totalClaimed = 0, totalRemaining = 0;
        displayData.forEach(item => {
            totalPurchase += item.purchase_qty;
            totalClaimed += item.claimed_qty;
            totalRemaining += item.remaining;

            const statusClass = item.status === '正常' ? 'tag-normal' :
                               item.status === '库存不足' ? 'tag-warning' : 'tag-danger';

            // 管理员可删除任何物品（包括有领取记录的，用于修正信息错误）
            const deleteBtn = `<button class="btn btn-danger btn-sm" onclick="deleteItem(${item.id}, '${item.name.replace(/'/g, "\\'")}', ${item.claimed_qty})" title="删除物品">🗑️</button>`;

            html += `
                <tr>
                    <td>${item.code}</td>
                    <td><strong>${item.name}</strong></td>
                    <td>${item.category}</td>
                    <td class="text-center">${item.unit}</td>
                    <td class="text-center">
                        <input type="number" class="edit-input" value="${item.purchase_qty}"
                               onchange="updateInventory(${item.id}, 'purchase_qty', this.value)" min="0">
                    </td>
                    <td class="text-center">${item.claimed_qty}</td>
                    <td class="text-center"><strong style="color:${item.remaining <= item.safety_stock ? '#C62828' : 'var(--text-main)'};">${item.remaining}</strong></td>
                    <td class="text-center">
                        <input type="number" class="edit-input" value="${item.safety_stock}"
                               onchange="updateInventory(${item.id}, 'safety_stock', this.value)" min="0">
                    </td>
                    <td class="text-center"><span class="tag ${statusClass}">${item.status}</span></td>
                    <td class="text-center">${deleteBtn}</td>
                </tr>`;
        });

        html += `
                </tbody>
                <tfoot>
                    <tr style="font-weight:700; background:var(--primary-light);">
                        <td colspan="4">合计</td>
                        <td class="text-center">${totalPurchase}</td>
                        <td class="text-center">${totalClaimed}</td>
                        <td class="text-center">${totalRemaining}</td>
                        <td colspan="3"></td>
                    </tr>
                </tfoot>
            </table>`;

        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<div class="alert alert-error">加载失败</div>';
    }
}

// 加载统计
async function loadStats() {
    try {
        const data = await getAdminStats();

        const s = data.summary;
        document.getElementById('stats-grid-2').innerHTML = `
            <div class="stat-card">
                <div class="stat-icon">📋</div>
                <div class="stat-label">总领取次数</div>
                <div class="stat-value">${s.total_requests}</div>
            </div>
            <div class="stat-card success">
                <div class="stat-icon">📦</div>
                <div class="stat-label">总领取数量</div>
                <div class="stat-value">${s.total_qty}</div>
            </div>
            <div class="stat-card warning">
                <div class="stat-icon">⏳</div>
                <div class="stat-label">待审核</div>
                <div class="stat-value">${s.pending}</div>
            </div>
            <div class="stat-card danger">
                <div class="stat-icon">⚠️</div>
                <div class="stat-label">库存预警数</div>
                <div class="stat-value">${s.low_stock}</div>
            </div>
        `;

        // 部门明细
        const totalQty = data.departments.reduce((sum, d) => sum + d.total_qty, 0) || 1;
        let html = `
            <table>
                <thead>
                    <tr>
                        <th>排名</th>
                        <th>部门</th>
                        <th class="text-center">领取次数</th>
                        <th class="text-center">领取数量</th>
                        <th class="text-center">占比</th>
                        <th>领用占比图</th>
                    </tr>
                </thead>
                <tbody>`;
        data.departments.forEach((d, i) => {
            const pct = (d.total_qty / totalQty * 100).toFixed(1);
            const rank = i + 1;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
            html += `
                <tr>
                    <td class="text-center" style="font-size:18px;">${medal}</td>
                    <td><strong>${d.department}</strong></td>
                    <td class="text-center">${d.req_count}</td>
                    <td class="text-center">${d.total_qty}</td>
                    <td class="text-center">${pct}%</td>
                    <td>
                        <div style="background:var(--primary-light); border-radius:4px; height:24px; width:100%; overflow:hidden; position:relative;">
                            <div style="background:linear-gradient(90deg, var(--primary), #64B5F6); height:100%; width:${pct}%; border-radius:4px; transition:width 0.5s;"></div>
                            <span style="position:absolute; right:8px; top:2px; font-size:12px; font-weight:600; color:var(--text-main);">${d.total_qty}件</span>
                        </div>
                    </td>
                </tr>`;
        });
        html += '</tbody></table>';
        document.getElementById('dept-detail-table').innerHTML = html;

    } catch (err) {
        console.error('加载统计失败:', err);
    }
}

// 导出 Excel（使用 SheetJS）
async function exportExcel(e) {
    e.preventDefault();
    try {
        showToast('正在导出 Excel 文件...', 'success');

        // 并行获取所有数据
        const [inventory, requests, stats, stockIn] = await Promise.all([
            getAdminInventory(),
            getAdminRequests(),
            getAdminStats(),
            getStockInRecords()
        ]);

        // Sheet 1: 库存总览
        const inventoryAOA = [
            ['物品编号', '物品名称', '类别', '单位', '采购数量', '已领取数量', '剩余库存', '安全库存', '库存状态']
        ];
        inventory.forEach(item => {
            inventoryAOA.push([
                item.code, item.name, item.category, item.unit,
                item.purchase_qty, item.claimed_qty, item.remaining,
                item.safety_stock, item.status
            ]);
        });

        // Sheet 2: 领取记录
        const requestsAOA = [
            ['序号', '日期', '领取部门', '物品编号', '物品名称', '领取数量', '领取人', '状态']
        ];
        requests.forEach((r, i) => {
            requestsAOA.push([
                i + 1, r.req_date, r.department, r.item_code,
                r.item_name, r.quantity, r.requester, r.status
            ]);
        });

        // Sheet 3: 部门汇总
        const deptAOA = [
            ['部门', '领取次数', '领取数量合计', '占比']
        ];
        const totalDeptQty = stats.departments.reduce((sum, d) => sum + d.total_qty, 0) || 1;
        stats.departments.forEach(d => {
            const pct = (d.total_qty / totalDeptQty * 100).toFixed(1) + '%';
            deptAOA.push([d.department, d.req_count, d.total_qty, pct]);
        });

        // Sheet 4: 入库记录
        const stockInAOA = [
            ['序号', '入库日期', '物品编号', '物品名称', '入库数量', '供应商/来源', '操作人', '备注']
        ];
        (stockIn || []).forEach((r, i) => {
            stockInAOA.push([
                i + 1, r.in_date, r.item_code, r.item_name,
                r.quantity, r.supplier || '', r.operator || '', r.notes || ''
            ]);
        });

        // 创建工作簿
        const wb = XLSX.utils.book_new();
        const ws1 = XLSX.utils.aoa_to_sheet(inventoryAOA);
        const ws2 = XLSX.utils.aoa_to_sheet(requestsAOA);
        const ws3 = XLSX.utils.aoa_to_sheet(deptAOA);
        const ws4 = XLSX.utils.aoa_to_sheet(stockInAOA);

        XLSX.utils.book_append_sheet(wb, ws1, '库存总览');
        XLSX.utils.book_append_sheet(wb, ws2, '领取记录');
        XLSX.utils.book_append_sheet(wb, ws3, '部门汇总');
        XLSX.utils.book_append_sheet(wb, ws4, '入库记录');

        // 下载文件
        XLSX.writeFile(wb, '古四村委会物资管理导出.xlsx');
    } catch (err) {
        showToast('导出失败：' + (err.message || '未知错误'), 'error');
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

// Toast
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
    }, 2500);
}


// ============================================================
// 新增物品 / 删除物品
// ============================================================

// 显示新增物品弹窗
async function showAddItemModal() {
    document.getElementById('add-item-modal').style.display = 'flex';
    document.getElementById('add-item-alert').innerHTML = '';
    // 清空表单
    document.getElementById('add-name').value = '';
    document.getElementById('add-code').value = '';
    document.getElementById('add-category').value = '';
    document.getElementById('add-category-new').value = '';
    document.getElementById('add-category-new').style.display = 'none';
    document.getElementById('add-unit').value = '';
    document.getElementById('add-purchase-qty').value = '0';
    document.getElementById('add-safety-stock').value = '0';
    // 加载分类列表到下拉框
    await populateCategorySelect('add-category');
    // 聚焦到名称输入框
    setTimeout(() => document.getElementById('add-name').focus(), 100);
}

// 关闭新增物品弹窗
function closeAddItemModal() {
    document.getElementById('add-item-modal').style.display = 'none';
}

// 提交新增物品
async function addItem(e) {
    e.preventDefault();
    const name = document.getElementById('add-name').value.trim();
    const code = document.getElementById('add-code').value.trim();
    let category = document.getElementById('add-category').value;
    // 如果选了"新增分类"，取输入框的值
    if (category === '__new__') {
        category = document.getElementById('add-category-new').value.trim();
    }
    const unit = document.getElementById('add-unit').value.trim();
    const purchaseQty = document.getElementById('add-purchase-qty').value;
    const safetyStock = document.getElementById('add-safety-stock').value;

    if (!name || !category || !unit) {
        document.getElementById('add-item-alert').innerHTML =
            '<div class="alert alert-error">❌ 物品名称、类别、单位为必填项</div>';
        return;
    }

    try {
        const data = await addInventory({
            name, code, category, unit,
            purchase_qty: parseInt(purchaseQty) || 0,
            safety_stock: parseInt(safetyStock) || 0
        });

        if (data.success) {
            // 如果是新输入的分类，自动添加到分类表
            if (document.getElementById('add-category').value === '__new__') {
                try { await addCategory(category); } catch(e) {}
            }
            showToast(data.message || '物品添加成功', 'success');
            closeAddItemModal();
            loadInventory();
            // 刷新筛选器中的物品列表
            loadFilters();
        } else {
            document.getElementById('add-item-alert').innerHTML =
                `<div class="alert alert-error">❌ ${data.error || '添加失败'}</div>`;
        }
    } catch (err) {
        document.getElementById('add-item-alert').innerHTML =
            '<div class="alert alert-error">❌ 网络错误，请重试</div>';
    }
}

// 删除物品
async function deleteItem(id, name, claimedQty) {
    const hasRecords = claimedQty > 0;
    const confirmMsg = hasRecords
        ? `⚠️ 确定要删除物品「${name}」吗？\n\n该物品已有 ${claimedQty} 件领取记录。\n删除后：\n• 物品将从库存列表中移除\n• 历史领取记录仍会保留（用于查账）\n• 此操作不可撤销，请谨慎操作！`
        : `确定要删除物品「${name}」吗？\n\n该物品暂无领取记录，删除后不可恢复。`;

    if (!confirm(confirmMsg)) return;

    try {
        const data = await deleteInventory(id);
        if (data.success) {
            showToast(data.message || '物品已删除', 'success');
            loadInventory();
            loadFilters();
            // 刷新仪表盘统计
            if (typeof loadDashboard === 'function') loadDashboard();
        } else {
            showToast(data.error || '删除失败', 'error');
        }
    } catch {
        showToast('网络错误', 'error');
    }
}

// 全局变量：是否只显示库存预警物品
let _filterLowStock = false;

// 点击库存预警卡片，跳转到库存管理并筛选预警物品
function showLowStockItems() {
    _filterLowStock = true;
    // 切换到库存管理 tab
    const link = document.querySelector('a[onclick*="switchTab(\'inventory\'"]');
    if (link) link.click();
    // 延迟加载，确保 tab 切换完成
    setTimeout(() => {
        loadInventory();
        showToast('已筛选出所有库存预警物品', 'success');
    }, 100);
}

// 清除库存预警筛选，显示所有物品
function clearLowStockFilter() {
    _filterLowStock = false;
    loadInventory();
}


// ============================================================
// 分类管理
// ============================================================

// 填充分类下拉框
async function populateCategorySelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const categories = await getCategories();

    select.innerHTML = '<option value="">请选择类别</option>';

    if (categories.length === 0) {
        // 分类表未创建或为空，直接显示新增分类输入
        select.innerHTML = '<option value="__new__">➕ 输入新分类...</option>';
        select.value = '__new__';
        const newInput = document.getElementById(selectId + '-new');
        if (newInput) newInput.style.display = 'block';
        return;
    }

    categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = c.name;
        select.appendChild(opt);
    });

    // 添加"新增分类"选项
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '➕ 输入新分类...';
    select.appendChild(newOpt);
}

// 分类下拉框变更处理
function handleCategoryChange(select, newInputId) {
    const newInput = document.getElementById(newInputId);
    if (!newInput) return;

    if (select.value === '__new__') {
        newInput.style.display = 'block';
        newInput.focus();
    } else {
        newInput.style.display = 'none';
        newInput.value = '';
    }
}

// 加载分类管理页面
async function loadCategoryPage() {
    const container = document.getElementById('category-table');
    container.innerHTML = '<div class="loading">加载中</div>';

    try {
        const [categories, inventory, borrowItems] = await Promise.all([
            getCategories(),
            getAdminInventory(),
            getAdminBorrowItems()
        ]);

        // 统计每个分类下的物品数量
        const invCount = {};
        (inventory || []).forEach(i => {
            invCount[i.category] = (invCount[i.category] || 0) + 1;
        });
        const borrowCount = {};
        (borrowItems || []).forEach(i => {
            borrowCount[i.category] = (borrowCount[i.category] || 0) + 1;
        });

        let html = `
            <table>
                <thead>
                    <tr>
                        <th class="text-center">序号</th>
                        <th>分类名称</th>
                        <th class="text-center">库存物品数</th>
                        <th class="text-center">借用物品数</th>
                        <th class="text-center">操作</th>
                    </tr>
                </thead>
                <tbody>`;

        if (categories.length === 0) {
            html += '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">暂无分类，请在上方添加分类<br><br><div class="alert" style="background:var(--warning-bg); color:var(--warning-text); padding:12px; border-radius:8px; display:inline-block;">💡 提示：如果看不到分类管理功能，请先在 Supabase SQL Editor 中执行 schema_categories.sql 建表脚本</div></td></tr>';
        }

        categories.forEach((cat, i) => {
            const ic = invCount[cat.name] || 0;
            const bc = borrowCount[cat.name] || 0;
            const canDelete = (ic + bc) === 0;
            const deleteBtn = canDelete
                ? `<button class="btn btn-danger btn-sm" onclick="handleDeleteCategory(${cat.id}, '${cat.name.replace(/'/g, "\\'")}')">🗑️ 删除</button>`
                : `<span style="color:var(--text-muted); font-size:12px;" title="分类下有物品，无法删除">有物品在使用</span>`;
            html += `
                <tr>
                    <td class="text-center">${i + 1}</td>
                    <td><strong>${cat.name}</strong></td>
                    <td class="text-center">${ic}</td>
                    <td class="text-center">${bc}</td>
                    <td class="text-center">${deleteBtn}</td>
                </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (err) {
        console.error('加载分类失败:', err);
        container.innerHTML = '<div class="alert alert-error">加载失败: ' + (err.message || err) + '</div>';
    }
}

// 添加分类
async function handleAddCategory(e) {
    if (e) e.preventDefault();
    const name = document.getElementById('new-category-name').value.trim();
    if (!name) {
        showToast('请输入分类名称', 'error');
        return;
    }

    try {
        const data = await addCategory(name);
        if (data.success) {
            showToast(data.message || '添加成功', 'success');
            document.getElementById('new-category-name').value = '';
            loadCategoryPage();
        } else {
            showToast(data.error || '添加失败', 'error');
        }
    } catch (err) {
        showToast('网络错误', 'error');
    }
}

// 删除分类
async function handleDeleteCategory(id, name) {
    if (!confirm(`确定要删除分类「${name}」吗？\n\n注意：分类下有物品时无法删除。`)) return;

    try {
        const data = await deleteCategory(id);
        if (data.success) {
            showToast(data.message || '已删除', 'success');
            loadCategoryPage();
        } else {
            showToast(data.error || '删除失败', 'error');
        }
    } catch (err) {
        showToast('网络错误', 'error');
    }
}


// ============================================================
// 借用管理
// ============================================================

// 加载借用管理页面（统计+物品+记录）
function loadBorrowPage() {
    loadBorrowStats();
    loadBorrowItems();
    loadBorrowRecords();
}

// 加载借用统计
async function loadBorrowStats() {
    try {
        const data = await getAdminBorrowStats();
        const s = data.summary;
        document.getElementById('borrow-stats-grid').innerHTML = `
            <div class="stat-card">
                <div class="stat-icon">📦</div>
                <div class="stat-label">可借物品种类</div>
                <div class="stat-value">${s.total_items}</div>
            </div>
            <div class="stat-card warning">
                <div class="stat-icon">📤</div>
                <div class="stat-label">借出中</div>
                <div class="stat-value">${s.outstanding}</div>
            </div>
            <div class="stat-card success">
                <div class="stat-icon">📥</div>
                <div class="stat-label">已归还</div>
                <div class="stat-value">${s.total_returned}</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">📊</div>
                <div class="stat-label">总借用次数</div>
                <div class="stat-value">${s.total_borrowed + s.total_returned}</div>
            </div>
        `;
    } catch (err) {
        console.error('加载借用统计失败:', err);
    }
}

// 加载可借用物品
async function loadBorrowItems() {
    const container = document.getElementById('borrow-items-table');
    container.innerHTML = '<div class="loading">加载中</div>';
    try {
        const items = await getAdminBorrowItems();

        if (items.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div>暂无可借用物品，点击右上角"新增借用物品"添加</div>
                </div>`;
            return;
        }

        let html = `
            <table>
                <thead>
                    <tr>
                        <th>物品名称</th>
                        <th>类别</th>
                        <th class="text-center">可借总数</th>
                        <th class="text-center">借出中</th>
                        <th class="text-center">可借数量</th>
                        <th class="text-center">操作</th>
                    </tr>
                </thead>
                <tbody>`;
        items.forEach(item => {
            const canDelete = item.borrowed_qty === 0;
            const deleteBtn = canDelete
                ? `<button class="btn btn-danger btn-sm" onclick="deleteBorrowItem(${item.id}, '${item.name.replace(/'/g, "\\'")}')">🗑️</button>`
                : `<span style="color:var(--text-muted); font-size:12px;" title="有借出未还记录">—</span>`;
            const availColor = item.available_qty === 0 ? '#C62828' : 'var(--text-main)';
            html += `
                <tr>
                    <td><strong>${item.name}</strong></td>
                    <td>${item.category}</td>
                    <td class="text-center">
                        <input type="number" class="edit-input" value="${item.total_qty}"
                               onchange="updateBorrowItem(${item.id}, 'total_qty', this.value)" min="1">
                    </td>
                    <td class="text-center">${item.borrowed_qty}</td>
                    <td class="text-center"><strong style="color:${availColor};">${item.available_qty}</strong></td>
                    <td class="text-center">${deleteBtn}</td>
                </tr>`;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<div class="alert alert-error">加载失败</div>';
    }
}

// 加载借用记录
async function loadBorrowRecords() {
    const container = document.getElementById('borrow-records-table');
    container.innerHTML = '<div class="loading">加载中</div>';

    // 构建 filters 对象
    const filters = {};
    const dept = document.getElementById('borrow-filter-dept').value;
    const status = document.getElementById('borrow-filter-status').value;
    if (dept) filters.department = dept;
    if (status) filters.status = status;

    try {
        const records = await getAdminBorrowRecords(filters);

        if (records.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div>暂无借用记录</div>
                </div>`;
            return;
        }

        let html = `
            <table>
                <thead>
                    <tr>
                        <th class="text-center">序号</th>
                        <th>借出日期</th>
                        <th>部门</th>
                        <th>物品名称</th>
                        <th class="text-center">数量</th>
                        <th>借用人</th>
                        <th class="text-center">状态</th>
                        <th>归还日期</th>
                        <th>备注</th>
                        <th class="text-center">操作</th>
                    </tr>
                </thead>
                <tbody>`;
        records.forEach((r, i) => {
            const statusTag = r.status === '借出中'
                ? '<span class="tag tag-pending">借出中</span>'
                : '<span class="tag tag-approved">已归还</span>';
            const action = r.status === '借出中'
                ? `<button class="btn btn-success btn-sm" onclick="returnBorrow(${r.id})">确认归还</button>`
                : '<span style="color:var(--text-muted); font-size:12px;">已完成</span>';
            html += `
                <tr>
                    <td class="text-center">${i + 1}</td>
                    <td>${r.borrow_date}</td>
                    <td>${r.department}</td>
                    <td><strong>${r.item_name}</strong></td>
                    <td class="text-center">${r.quantity}</td>
                    <td>${r.borrower}</td>
                    <td class="text-center">${statusTag}</td>
                    <td>${r.return_date || '-'}</td>
                    <td>${r.notes || '-'}</td>
                    <td class="text-center">${action}</td>
                </tr>`;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<div class="alert alert-error">加载失败</div>';
    }
}

// 显示新增借用物品弹窗
async function showAddBorrowItemModal() {
    document.getElementById('add-borrow-item-modal').style.display = 'flex';
    document.getElementById('add-borrow-item-alert').innerHTML = '';
    document.getElementById('add-borrow-name').value = '';
    document.getElementById('add-borrow-category').value = '';
    document.getElementById('add-borrow-category-new').value = '';
    document.getElementById('add-borrow-category-new').style.display = 'none';
    document.getElementById('add-borrow-qty').value = '1';
    // 加载分类列表到下拉框
    await populateCategorySelect('add-borrow-category');
    setTimeout(() => document.getElementById('add-borrow-name').focus(), 100);
}

// 关闭新增借用物品弹窗
function closeAddBorrowItemModal() {
    document.getElementById('add-borrow-item-modal').style.display = 'none';
}


// ============================================================
// 入库管理
// ============================================================

// 加载入库记录
async function loadStockIn() {
    const container = document.getElementById('stockin-table');
    container.innerHTML = '<div class="loading">加载中</div>';

    // 构建 filters 对象
    const filters = {};
    const item = document.getElementById('stockin-filter-item').value;
    const dateFrom = document.getElementById('stockin-date-from').value;
    const dateTo = document.getElementById('stockin-date-to').value;

    if (item) filters.item_code = item;
    if (dateFrom) filters.date_from = dateFrom;
    if (dateTo) filters.date_to = dateTo;

    try {
        const records = await getStockInRecords(filters);

        if (records.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div>暂无入库记录，点击右上角"新增入库"添加</div>
                </div>`;
            return;
        }

        let html = `
            <table>
                <thead>
                    <tr>
                        <th class="text-center">序号</th>
                        <th>入库日期</th>
                        <th>物品编号</th>
                        <th>物品名称</th>
                        <th class="text-center">入库数量</th>
                        <th>供应商/来源</th>
                        <th>操作人</th>
                        <th>备注</th>
                        <th class="text-center">操作</th>
                    </tr>
                </thead>
                <tbody>`;

        let totalQty = 0;
        records.forEach((r, i) => {
            totalQty += r.quantity;
            html += `
                <tr>
                    <td class="text-center">${i + 1}</td>
                    <td>${r.in_date}</td>
                    <td>${r.item_code}</td>
                    <td><strong>${r.item_name}</strong></td>
                    <td class="text-center"><strong style="color:#2E7D32;">+${r.quantity}</strong></td>
                    <td>${r.supplier || '-'}</td>
                    <td>${r.operator || '-'}</td>
                    <td>${r.notes || '-'}</td>
                    <td class="text-center">
                        <button class="btn btn-danger btn-sm" onclick="deleteStockInRecord(${r.id}, '${r.item_name.replace(/'/g, "\\'")}')" title="删除">🗑️</button>
                    </td>
                </tr>`;
        });

        html += `
                </tbody>
                <tfoot>
                    <tr style="font-weight:700; background:var(--primary-light);">
                        <td colspan="4">合计 ${records.length} 条入库记录</td>
                        <td class="text-center" style="color:#2E7D32;">+${totalQty}</td>
                        <td colspan="4"></td>
                    </tr>
                </tfoot>
            </table>`;

        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<div class="alert alert-error">加载失败：' + (err.message || err) + '</div>';
    }
}

// 显示新增入库弹窗
async function showAddStockInModal() {
    document.getElementById('add-stockin-modal').style.display = 'flex';
    document.getElementById('add-stockin-alert').innerHTML = '';
    // 清空表单
    document.getElementById('stockin-item').value = '';
    document.getElementById('stockin-qty').value = '1';
    document.getElementById('stockin-supplier').value = '';
    document.getElementById('stockin-operator').value = '';
    document.getElementById('stockin-date').value = '';
    document.getElementById('stockin-notes').value = '';

    // 加载物品列表到下拉框
    try {
        const items = await getInventory();
        const select = document.getElementById('stockin-item');
        select.innerHTML = '<option value="">请选择物品</option>';
        items.forEach(i => {
            const opt = document.createElement('option');
            opt.value = i.code;
            opt.textContent = `${i.name} (${i.unit}) - 当前库存${i.remaining || 0}`;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error('加载物品列表失败:', e);
    }

    setTimeout(() => document.getElementById('stockin-item').focus(), 100);
}

// 关闭新增入库弹窗
function closeAddStockInModal() {
    document.getElementById('add-stockin-modal').style.display = 'none';
}

// 提交入库登记
async function addStockInRecord(e) {
    e.preventDefault();
    const itemCode = document.getElementById('stockin-item').value;
    const quantity = document.getElementById('stockin-qty').value;
    const supplier = document.getElementById('stockin-supplier').value.trim();
    const operator = document.getElementById('stockin-operator').value.trim();
    const inDate = document.getElementById('stockin-date').value.trim();
    const notes = document.getElementById('stockin-notes').value.trim();

    if (!itemCode || !quantity || !operator) {
        document.getElementById('add-stockin-alert').innerHTML =
            '<div class="alert alert-error">❌ 物品、入库数量、操作人为必填项</div>';
        return;
    }

    if (parseInt(quantity) <= 0) {
        document.getElementById('add-stockin-alert').innerHTML =
            '<div class="alert alert-error">❌ 入库数量必须大于0</div>';
        return;
    }

    try {
        const data = await addStockIn({
            item_code: itemCode,
            quantity: parseInt(quantity),
            supplier,
            operator,
            in_date: inDate || undefined,
            notes
        });

        if (data.success) {
            showToast(data.message || '入库成功', data.warning ? 'error' : 'success');
            closeAddStockInModal();
            loadStockIn();
            // 刷新库存和筛选器
            loadFilters();
        } else {
            document.getElementById('add-stockin-alert').innerHTML =
                `<div class="alert alert-error">❌ ${data.error || '入库失败'}</div>`;
        }
    } catch (err) {
        document.getElementById('add-stockin-alert').innerHTML =
            '<div class="alert alert-error">❌ 网络错误，请重试</div>';
    }
}

// 删除入库记录
async function deleteStockInRecord(id, name) {
    if (!confirm(`确定要删除物品「${name}」的这条入库记录吗？\n\n注意：删除后会自动扣减对应物品的库存数量。`)) return;

    try {
        const data = await deleteStockIn(id);
        if (data.success) {
            showToast(data.message || '已删除', 'success');
            loadStockIn();
            loadFilters();
        } else {
            showToast(data.error || '删除失败', 'error');
        }
    } catch {
        showToast('网络错误', 'error');
    }
}


// ============================================================
// 需求采购管理
// ============================================================

// 加载需求管理页面
function loadPurchasePage() {
    loadPurchaseStats();
    loadPurchaseRequests();
}

// 加载需求统计
async function loadPurchaseStats() {
    try {
        const data = await getPurchaseRequestStats();
        const s = data.summary;
        document.getElementById('purchase-stats-grid').innerHTML = `
            <div class="stat-card">
                <div class="stat-icon">📋</div>
                <div class="stat-label">需求总数</div>
                <div class="stat-value">${s.total}</div>
            </div>
            <div class="stat-card warning">
                <div class="stat-icon">⏳</div>
                <div class="stat-label">待采购</div>
                <div class="stat-value">${s.pending}</div>
            </div>
            <div class="stat-card success">
                <div class="stat-icon">✅</div>
                <div class="stat-label">已采购</div>
                <div class="stat-value">${s.purchased}</div>
            </div>
            <div class="stat-card danger">
                <div class="stat-icon">❌</div>
                <div class="stat-label">已拒绝</div>
                <div class="stat-value">${s.rejected}</div>
            </div>
        `;
    } catch (err) {
        console.error('加载需求统计失败:', err);
    }
}

// 加载需求列表
async function loadPurchaseRequests() {
    const container = document.getElementById('purchase-table');
    container.innerHTML = '<div class="loading">加载中</div>';

    const filters = {};
    const dept = document.getElementById('purchase-filter-dept').value;
    const status = document.getElementById('purchase-filter-status').value;
    const dateFrom = document.getElementById('purchase-date-from').value;
    const dateTo = document.getElementById('purchase-date-to').value;

    if (dept) filters.department = dept;
    if (status) filters.status = status;
    if (dateFrom) filters.date_from = dateFrom;
    if (dateTo) filters.date_to = dateTo;

    try {
        const records = await getAdminPurchaseRequests(filters);

        if (records.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div>暂无采购需求</div>
                </div>`;
            return;
        }

        let html = `
            <table>
                <thead>
                    <tr>
                        <th class="text-center">序号</th>
                        <th>申请日期</th>
                        <th>部门</th>
                        <th>申请人</th>
                        <th>物品名称</th>
                        <th>类别</th>
                        <th class="text-center">数量</th>
                        <th>单位</th>
                        <th class="text-center">预估单价</th>
                        <th>申请原因</th>
                        <th class="text-center">状态</th>
                        <th class="text-center">操作</th>
                    </tr>
                </thead>
                <tbody>`;

        records.forEach((r, i) => {
            const statusTag = getPurchaseStatusTag(r.status);
            const actions = r.status === '待采购'
                ? `<button class="btn btn-success btn-sm" onclick="updatePurchaseStatus(${r.id}, '已采购')" title="标记已采购">✅ 已采购</button>
                   <button class="btn btn-danger btn-sm" onclick="updatePurchaseStatus(${r.id}, '已拒绝')" title="拒绝">❌ 拒绝</button>
                   <button class="btn btn-outline btn-sm" onclick="deletePurchaseRequest(${r.id}, '${r.item_name.replace(/'/g, "\\'")}')" title="删除">🗑️</button>`
                : `<button class="btn btn-outline btn-sm" onclick="deletePurchaseRequest(${r.id}, '${r.item_name.replace(/'/g, "\\'")}')" title="删除">🗑️</button>`;

            const price = r.estimated_price ? `¥${r.estimated_price}` : '-';
            html += `
                <tr>
                    <td class="text-center">${i + 1}</td>
                    <td>${r.req_date}</td>
                    <td>${r.department}</td>
                    <td>${r.requester}</td>
                    <td><strong>${r.item_name}</strong></td>
                    <td>${r.category || '-'}</td>
                    <td class="text-center">${r.quantity}</td>
                    <td>${r.unit || '-'}</td>
                    <td class="text-center">${price}</td>
                    <td style="max-width:200px; font-size:12px;">${r.reason || '-'}</td>
                    <td class="text-center">${statusTag}</td>
                    <td class="text-center" style="white-space:nowrap;">${actions}</td>
                </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<div class="alert alert-error">加载失败：' + (err.message || err) + '</div>';
    }
}

// 更新需求状态
async function updatePurchaseStatus(id, status) {
    let notes = '';
    if (status === '已拒绝') {
        notes = prompt('请输入拒绝原因（选填）：') || '';
    }
    try {
        const data = await updatePurchaseRequestStatus(id, status, notes);
        if (data.success) {
            showToast(data.message || '操作成功', 'success');
            loadPurchasePage();
        } else {
            showToast(data.error || '操作失败', 'error');
        }
    } catch {
        showToast('网络错误', 'error');
    }
}

// 删除需求
async function deletePurchaseRequest(id, name) {
    if (!confirm(`确定要删除物品「${name}」的这条采购需求吗？`)) return;
    try {
        const data = await deletePurchaseRequest(id);
        if (data.success) {
            showToast(data.message || '已删除', 'success');
            loadPurchasePage();
        } else {
            showToast(data.error || '删除失败', 'error');
        }
    } catch {
        showToast('网络错误', 'error');
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


// ============================================================
// 以下函数与 db.js 同名，使用 window 赋值替代 function 声明
// 避免函数声明提升导致覆盖 db.js 原始函数（通过上方 _db* 引用调用）
// HTML 中的 onclick/onchange/onsubmit 通过全局查找 window.* 调用
// ============================================================

// 确认归还（调用 db.js 的 returnBorrow）
window.returnBorrow = async function(id) {
    if (!confirm('确认该物品已归还？')) return;
    try {
        const data = await _dbReturnBorrow(id);
        if (data.success) {
            showToast(data.message || '已确认归还', 'success');
            loadBorrowPage();
        } else {
            showToast(data.error || '操作失败', 'error');
        }
    } catch {
        showToast('网络错误', 'error');
    }
};

// 更新库存（调用 db.js 的 updateInventory）
window.updateInventory = async function(id, field, value) {
    try {
        const data = await _dbUpdateInventory(id, field, value);
        if (data.success) {
            showToast('库存已更新', 'success');
            loadInventory();
        } else {
            showToast('更新失败', 'error');
            loadInventory();
        }
    } catch {
        showToast('网络错误', 'error');
    }
};

// 更新借用物品（调用 db.js 的 updateBorrowItem）
window.updateBorrowItem = async function(id, field, value) {
    try {
        const data = await _dbUpdateBorrowItem(id, field, value);
        if (data.success) {
            showToast('已更新', 'success');
            loadBorrowItems();
        } else {
            showToast('更新失败', 'error');
            loadBorrowItems();
        }
    } catch {
        showToast('网络错误', 'error');
    }
};

// 删除借用物品（调用 db.js 的 deleteBorrowItem）
window.deleteBorrowItem = async function(id, name) {
    if (!confirm(`确定要删除物品「${name}」吗？\n\n注意：有借出未还记录的物品无法删除。`)) return;
    try {
        const data = await _dbDeleteBorrowItem(id);
        if (data.success) {
            showToast(data.message || '已删除', 'success');
            loadBorrowItems();
            loadBorrowStats();
        } else {
            showToast(data.error || '删除失败', 'error');
        }
    } catch {
        showToast('网络错误', 'error');
    }
};

// 提交新增借用物品（调用 db.js 的 addBorrowItem）
window.addBorrowItem = async function(e) {
    e.preventDefault();
    const name = document.getElementById('add-borrow-name').value.trim();
    let category = document.getElementById('add-borrow-category').value;
    // 如果选了"新增分类"，取输入框的值
    if (category === '__new__') {
        category = document.getElementById('add-borrow-category-new').value.trim();
    }
    const totalQty = document.getElementById('add-borrow-qty').value;

    if (!name || !category) {
        document.getElementById('add-borrow-item-alert').innerHTML =
            '<div class="alert alert-error">❌ 物品名称和类别为必填项</div>';
        return;
    }

    try {
        const data = await _dbAddBorrowItem({ name, category, total_qty: parseInt(totalQty) || 1 });
        if (data.success) {
            // 如果是新输入的分类，自动添加到分类表
            if (document.getElementById('add-borrow-category').value === '__new__') {
                try { await addCategory(category); } catch(e) {}
            }
            showToast(data.message || '添加成功', 'success');
            closeAddBorrowItemModal();
            loadBorrowItems();
            loadBorrowStats();
        } else {
            document.getElementById('add-borrow-item-alert').innerHTML =
                `<div class="alert alert-error">❌ ${data.error || '添加失败'}</div>`;
        }
    } catch {
        document.getElementById('add-borrow-item-alert').innerHTML =
            '<div class="alert alert-error">❌ 网络错误，请重试</div>';
    }
};


// ============================================================
// 通知系统（轮询新申请）
// ============================================================

let _notificationTimer = null;
let _lastNotificationCount = { request: 0, borrow: 0, purchase: 0 };
let _currentNotificationType = null;

// 启动通知轮询（每30秒检查一次）
function startNotificationPolling() {
    stopNotificationPolling();
    // 首次检查
    checkNewNotifications(true);
    // 定时轮询
    _notificationTimer = setInterval(() => {
        if (isLoggedIn) checkNewNotifications(false);
    }, 30000);
}

// 停止通知轮询
function stopNotificationPolling() {
    if (_notificationTimer) {
        clearInterval(_notificationTimer);
        _notificationTimer = null;
    }
}

// 检查新通知
async function checkNewNotifications(isFirstCheck) {
    try {
        // 并行获取三类待处理数据
        const [pendingRequests, pendingBorrows, pendingPurchases] = await Promise.all([
            getAdminRequests({ status: '待审核' }),
            getAdminBorrowRecords({ status: '借出中' }),
            getAdminPurchaseRequests({ status: '待采购' })
        ]);

        const reqCount = pendingRequests.length;
        const borrowCount = pendingBorrows.length;
        const purchaseCount = pendingPurchases.length;
        const total = reqCount + borrowCount + purchaseCount;

        // 更新徽章
        updateNotificationBadge(total);

        // 如果不是首次检查，且有新增的待处理项，弹出浮动通知
        if (!isFirstCheck) {
            if (reqCount > _lastNotificationCount.request) {
                showFloatingNotification('request', `有 ${reqCount - _lastNotificationCount.request} 条新的领取申请待审核`, reqCount);
            } else if (borrowCount > _lastNotificationCount.borrow) {
                showFloatingNotification('borrow', `有 ${borrowCount - _lastNotificationCount.borrow} 条新的借用申请`, borrowCount);
            } else if (purchaseCount > _lastNotificationCount.purchase) {
                showFloatingNotification('purchase', `有 ${purchaseCount - _lastNotificationCount.purchase} 条新的采购需求`, purchaseCount);
            }
        }

        // 更新上次计数
        _lastNotificationCount = { request: reqCount, borrow: borrowCount, purchase: purchaseCount };

        // 渲染通知列表
        renderNotificationList(pendingRequests, pendingBorrows, pendingPurchases);
    } catch (err) {
        console.warn('检查通知失败:', err);
    }
}

// 更新通知徽章
function updateNotificationBadge(count) {
    const badge = document.getElementById('notification-badge');
    if (!badge) return;
    if (count > 0) {
        badge.style.display = 'inline-block';
        badge.textContent = count > 99 ? '99+' : count;
    } else {
        badge.style.display = 'none';
    }
}

// 显示浮动通知
function showFloatingNotification(type, content, count) {
    _currentNotificationType = type;
    const panel = document.getElementById('floating-notification');
    const icon = document.getElementById('float-notif-icon');
    const title = document.getElementById('float-notif-title');
    const contentEl = document.getElementById('float-notif-content');

    const config = {
        request: { icon: '📋', title: '新的领取申请', color: '#FF9800' },
        borrow: { icon: '📤', title: '新的借用申请', color: '#2196F3' },
        purchase: { icon: '🛒', title: '新的采购需求', color: '#9C27B0' }
    };
    const c = config[type] || config.request;

    icon.textContent = c.icon;
    title.textContent = c.title;
    contentEl.textContent = content;
    panel.style.borderLeftColor = c.color;
    panel.style.display = 'block';

    // 8秒后自动关闭
    setTimeout(() => {
        if (panel.style.display === 'block') closeFloatingNotification();
    }, 8000);
}

// 关闭浮动通知
function closeFloatingNotification() {
    const panel = document.getElementById('floating-notification');
    if (panel) panel.style.display = 'none';
}

// 查看通知详情（跳转到对应页面）
function viewNotification() {
    closeFloatingNotification();
    document.getElementById('notification-panel').style.display = 'none';
    if (_currentNotificationType === 'request') {
        switchTab('requests', { target: document.querySelector('a[onclick*="requests"]'), preventDefault: () => {} });
    } else if (_currentNotificationType === 'borrow') {
        switchTab('borrow', { target: document.querySelector('a[onclick*="borrow"]'), preventDefault: () => {} });
    } else if (_currentNotificationType === 'purchase') {
        switchTab('purchase', { target: document.querySelector('a[onclick*="purchase"]'), preventDefault: () => {} });
    }
}

// 切换通知面板
function toggleNotificationPanel(e) {
    e.preventDefault();
    const panel = document.getElementById('notification-panel');
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
    } else {
        panel.style.display = 'block';
        // 立即刷新一次
        checkNewNotifications(false);
    }
}

// 渲染通知列表
function renderNotificationList(requests, borrows, purchases) {
    const list = document.getElementById('notification-list');
    if (!list) return;

    const total = requests.length + borrows.length + purchases.length;
    if (total === 0) {
        list.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">✅ 暂无待处理通知</div>';
        return;
    }

    let html = '';

    // 领取申请
    if (requests.length > 0) {
        html += `<div style="padding:8px 16px; background:#FFF3E0; font-size:12px; font-weight:600; color:#E65100;">📋 待审核领取申请 (${requests.length})</div>`;
        requests.slice(0, 5).forEach(r => {
            html += `
                <div onclick="jumpToTab('requests')" style="padding:10px 16px; border-bottom:1px solid #f0f0f0; cursor:pointer; hover:background:#f5f5f5;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background=''">
                    <div style="font-size:13px; font-weight:500; color:#333;">${r.requester} - ${r.item_name}</div>
                    <div style="font-size:11px; color:#999; margin-top:2px;">${r.department} · ${r.quantity}件 · ${r.req_date}</div>
                </div>`;
        });
        if (requests.length > 5) {
            html += `<div onclick="jumpToTab('requests')" style="padding:8px 16px; text-align:center; font-size:12px; color:#1976D2; cursor:pointer;">查看全部 ${requests.length} 条 →</div>`;
        }
    }

    // 借用申请
    if (borrows.length > 0) {
        html += `<div style="padding:8px 16px; background:#E3F2FD; font-size:12px; font-weight:600; color:#1565C0;">📤 借出中 (${borrows.length})</div>`;
        borrows.slice(0, 5).forEach(r => {
            html += `
                <div onclick="jumpToTab('borrow')" style="padding:10px 16px; border-bottom:1px solid #f0f0f0; cursor:pointer;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background=''">
                    <div style="font-size:13px; font-weight:500; color:#333;">${r.borrower} - ${r.item_name}</div>
                    <div style="font-size:11px; color:#999; margin-top:2px;">${r.department} · ${r.quantity}件 · ${r.borrow_date}</div>
                </div>`;
        });
        if (borrows.length > 5) {
            html += `<div onclick="jumpToTab('borrow')" style="padding:8px 16px; text-align:center; font-size:12px; color:#1976D2; cursor:pointer;">查看全部 ${borrows.length} 条 →</div>`;
        }
    }

    // 采购需求
    if (purchases.length > 0) {
        html += `<div style="padding:8px 16px; background:#F3E5F5; font-size:12px; font-weight:600; color:#6A1B9A;">🛒 待采购需求 (${purchases.length})</div>`;
        purchases.slice(0, 5).forEach(r => {
            html += `
                <div onclick="jumpToTab('purchase')" style="padding:10px 16px; border-bottom:1px solid #f0f0f0; cursor:pointer;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background=''">
                    <div style="font-size:13px; font-weight:500; color:#333;">${r.requester} - ${r.item_name}</div>
                    <div style="font-size:11px; color:#999; margin-top:2px;">${r.department} · ${r.quantity}${r.unit || ''} · ${r.req_date}</div>
                </div>`;
        });
        if (purchases.length > 5) {
            html += `<div onclick="jumpToTab('purchase')" style="padding:8px 16px; text-align:center; font-size:12px; color:#1976D2; cursor:pointer;">查看全部 ${purchases.length} 条 →</div>`;
        }
    }

    list.innerHTML = html;
}

// 跳转到指定 tab（通知面板中使用）
function jumpToTab(tab) {
    document.getElementById('notification-panel').style.display = 'none';
    const link = document.querySelector(`a[onclick*="switchTab('${tab}'"]`);
    if (link) link.click();
}
