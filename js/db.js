/**
 * 数据库操作层 - 直接使用 Supabase REST API (PostgREST)
 * 不依赖 Supabase JS 客户端，使用原生 fetch
 * 所有函数返回格式与原 Flask API 一致
 */

const API_BASE = SUPABASE_URL + '/rest/v1';
const API_HEADERS = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    'Content-Type': 'application/json'
};

// ============================================================
// 通用辅助
// ============================================================
function today() {
    const d = new Date();
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

// 通用 GET 请求
async function apiGet(table, query = '') {
    const url = `${API_BASE}/${table}?${query}`;
    const resp = await fetch(url, { headers: API_HEADERS });
    if (!resp.ok) {
        const text = await resp.text();
        console.error(`GET ${table} failed:`, resp.status, text);
        return [];
    }
    return resp.json();
}

// 通用 POST 请求
async function apiPost(table, data) {
    const resp = await fetch(`${API_BASE}/${table}`, {
        method: 'POST',
        headers: { ...API_HEADERS, 'Prefer': 'return=representation' },
        body: JSON.stringify(data)
    });
    if (!resp.ok) {
        const text = await resp.text();
        console.error(`POST ${table} failed:`, resp.status, text);
        return { error: `数据库写入失败 (${resp.status})` };
    }
    return resp.json();
}

// 通用 PATCH 请求
async function apiPatch(table, filter, data) {
    const resp = await fetch(`${API_BASE}/${table}?${filter}`, {
        method: 'PATCH',
        headers: { ...API_HEADERS, 'Prefer': 'return=representation' },
        body: JSON.stringify(data)
    });
    if (!resp.ok) {
        const text = await resp.text();
        console.error(`PATCH ${table} failed:`, resp.status, text);
        return { error: `数据库更新失败 (${resp.status})` };
    }
    return resp.json();
}

// 通用 DELETE 请求
async function apiDelete(table, filter) {
    const resp = await fetch(`${API_BASE}/${table}?${filter}`, {
        method: 'DELETE',
        headers: API_HEADERS
    });
    if (!resp.ok) {
        const text = await resp.text();
        console.error(`DELETE ${table} failed:`, resp.status, text);
        return { error: `数据库删除失败 (${resp.status})` };
    }
    return { success: true };
}

// 单行查询
async function apiSingle(table, query = '') {
    const url = `${API_BASE}/${table}?${query}&limit=1`;
    const resp = await fetch(url, { headers: { ...API_HEADERS, 'Accept': 'application/vnd.pgrst.object+json' } });
    if (resp.status === 406) return null; // No rows found
    if (!resp.ok) {
        const text = await resp.text();
        console.error(`GET(single) ${table} failed:`, resp.status, text);
        return null;
    }
    return resp.json();
}

// 计数查询
async function apiCount(table, filter = '') {
    const url = `${API_BASE}/${table}?${filter}`;
    const resp = await fetch(url, {
        headers: { ...API_HEADERS, 'Prefer': 'count=exact' }
    });
    if (!resp.ok) return 0;
    const count = resp.headers.get('content-range');
    if (count) {
        const parts = count.split('/');
        return parseInt(parts[1]) || 0;
    }
    const data = await resp.json();
    return data.length;
}

// ============================================================
// 员工端 API
// ============================================================

async function getDepartments() {
    return DEPARTMENTS;
}

async function getInventory() {
    return apiGet('inventory', 'select=code,name,category,unit&order=category.asc,code.asc');
}

async function submitRequest(data) {
    // 验证物品是否存在
    const item = await apiSingle('inventory', `code=eq.${encodeURIComponent(data.item_code)}`);
    if (!item) return { error: '物品编号不存在' };

    const result = await apiPost('requests', {
        req_date: today(),
        department: data.department,
        item_code: data.item_code,
        item_name: item.name,
        quantity: parseInt(data.quantity),
        requester: data.requester,
        status: '待审核',
        notes: data.notes || ''
    });

    if (result.error) return result;
    return { success: true, message: '领取申请已提交，等待管理员审核' };
}

async function getMyRequests(name) {
    return apiGet('requests', `select=*&requester=eq.${encodeURIComponent(name)}&order=created_at.desc&limit=50`);
}

async function getBorrowItems() {
    return apiGet('borrow_items_available', 'select=*&order=category.asc,id.asc');
}

async function submitBorrow(data) {
    const item = await apiSingle('borrow_items_available', `id=eq.${data.item_id}`);
    if (!item) return { error: '物品不存在' };
    if (parseInt(data.quantity) > item.available_qty) {
        return { error: `可借数量不足，当前可借 ${item.available_qty} 件` };
    }

    const result = await apiPost('borrow_records', {
        borrow_date: today(),
        department: data.department,
        item_id: parseInt(data.item_id),
        item_name: item.name,
        quantity: parseInt(data.quantity),
        borrower: data.borrower,
        status: '借出中',
        notes: data.notes || ''
    });

    if (result.error) return result;
    return { success: true, message: '借用申请已提交' };
}

async function getMyBorrows(name) {
    return apiGet('borrow_records', `select=*&borrower=eq.${encodeURIComponent(name)}&order=created_at.desc&limit=50`);
}

// ============================================================
// 分类管理 API
// ============================================================

async function getCategories() {
    try {
        return await apiGet('categories', 'select=*&order=sort_order.asc,name.asc');
    } catch (e) {
        // 表可能还未创建，返回空数组
        console.warn('分类表未创建或不可访问:', e);
        return [];
    }
}

async function addCategory(name) {
    const result = await apiPost('categories', { name: name.trim() });
    if (result.error) return result;
    return { success: true, message: `分类「${name}」已添加` };
}

async function deleteCategory(id) {
    const cat = await apiSingle('categories', `id=eq.${id}`);
    if (!cat) return { error: '分类不存在' };

    // 检查是否有物品使用此分类
    const invCount = await apiCount('inventory', `category=eq.${encodeURIComponent(cat.name)}`);
    const borrowCount = await apiCount('borrow_items', `category=eq.${encodeURIComponent(cat.name)}`);

    if (invCount > 0 || borrowCount > 0) {
        return { error: `该分类下有 ${invCount} 个库存物品和 ${borrowCount} 个借用物品，无法删除` };
    }

    const result = await apiDelete('categories', `id=eq.${id}`);
    if (result.error) return result;
    return { success: true, message: `分类「${cat.name}」已删除` };
}

// ============================================================
// 管理员端 API
// ============================================================

function adminLogin(username, password) {
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        localStorage.setItem('admin_logged_in', 'true');
        return { success: true, message: '登录成功' };
    }
    return { error: '用户名或密码错误' };
}

function adminCheck() {
    return localStorage.getItem('admin_logged_in') === 'true';
}

function adminLogout() {
    localStorage.removeItem('admin_logged_in');
}

async function getAdminRequests(filters = {}) {
    let query = 'select=*&order=created_at.desc';
    if (filters.department) query += `&department=eq.${encodeURIComponent(filters.department)}`;
    if (filters.item_code) query += `&item_code=eq.${encodeURIComponent(filters.item_code)}`;
    if (filters.status) query += `&status=eq.${encodeURIComponent(filters.status)}`;
    if (filters.date_from) query += `&req_date=gte.${encodeURIComponent(filters.date_from)}`;
    if (filters.date_to) query += `&req_date=lte.${encodeURIComponent(filters.date_to)}`;
    return apiGet('requests', query);
}

async function updateRequestStatus(id, status) {
    const result = await apiPatch('requests', `id=eq.${id}`, { status });
    if (result.error) return result;
    return { success: true };
}

async function getAdminInventory() {
    const data = await apiGet('inventory_with_claimed', 'select=*&order=category.asc,code.asc');
    return (data || []).map(item => {
        const remaining = item.remaining;
        const status = remaining <= 0 ? '已缺货' : remaining <= item.safety_stock ? '库存不足' : '正常';
        return { ...item, status };
    });
}

async function addInventory(data) {
    let code = data.code;
    if (!code) {
        const items = await apiGet('inventory', 'select=code&code=like.WB-*&order=code.desc&limit=1');
        if (items && items.length > 0) {
            const lastNum = parseInt(items[0].code.replace('WB-', ''));
            code = `WB-${String(lastNum + 1).padStart(3, '0')}`;
        } else {
            code = 'WB-001';
        }
    } else {
        const existing = await apiSingle('inventory', `code=eq.${encodeURIComponent(code)}`);
        if (existing) return { error: `物品编号 ${code} 已存在` };
    }

    const result = await apiPost('inventory', {
        code, name: data.name, category: data.category, unit: data.unit,
        purchase_qty: parseInt(data.purchase_qty) || 0,
        safety_stock: parseInt(data.safety_stock) || 0
    });

    if (result.error) return result;
    return { success: true, message: `物品「${data.name}」已添加`, code };
}

async function deleteInventory(id) {
    const item = await apiSingle('inventory', `id=eq.${id}`);
    if (!item) return { error: '物品不存在' };

    // 管理员可强制删除有记录的物品（用于修正信息错误）
    const count = await apiCount('requests', `item_code=eq.${encodeURIComponent(item.code)}`);

    const result = await apiDelete('inventory', `id=eq.${id}`);
    if (result.error) return result;

    const msg = count > 0
        ? `物品「${item.name}」已删除（该物品原有 ${count} 条领取记录，记录保留但物品已移除）`
        : `物品「${item.name}」已删除`;
    return { success: true, message: msg };
}

async function updateInventory(id, field, value) {
    const updateData = {};
    updateData[field] = parseInt(value);
    const result = await apiPatch('inventory', `id=eq.${id}`, updateData);
    if (result.error) return result;
    return { success: true };
}

async function getAdminStats() {
    // 获取所有领取记录（非已拒绝）
    const allReq = await apiGet('requests', 'select=department,quantity,status&status=neq.已拒绝');

    // 获取所有状态（用于待审核统计）
    const allStatuses = await apiGet('requests', 'select=status');
    const pending = (allStatuses || []).filter(r => r.status === '待审核').length;

    // 获取库存（含已领数量）
    const items = await apiGet('inventory_with_claimed', 'select=*');

    const total_requests = allReq.length;
    const total_qty = allReq.reduce((s, r) => s + r.quantity, 0);
    const total_items = items.length;
    const low_stock = items.filter(i => i.remaining <= i.safety_stock).length;

    // 部门统计
    const deptMap = {};
    allReq.forEach(r => {
        if (!deptMap[r.department]) deptMap[r.department] = { department: r.department, req_count: 0, total_qty: 0 };
        deptMap[r.department].req_count++;
        deptMap[r.department].total_qty += r.quantity;
    });
    const departments = Object.values(deptMap).sort((a, b) => b.total_qty - a.total_qty);

    // 类别统计
    const catMap = {};
    items.forEach(i => {
        if (!catMap[i.category]) catMap[i.category] = { category: i.category, purchase_total: 0, claimed_total: 0 };
        catMap[i.category].purchase_total += i.purchase_qty;
        catMap[i.category].claimed_total += i.claimed_qty;
    });
    const categories = Object.values(catMap).sort((a, b) => a.category.localeCompare(b.category));

    return {
        summary: { total_requests, total_qty, pending, total_items, low_stock },
        departments,
        categories
    };
}

// ============================================================
// 管理员端 - 借用管理 API
// ============================================================

async function getAdminBorrowItems() {
    return apiGet('borrow_items_available', 'select=*&order=category.asc,id.asc');
}

async function addBorrowItem(data) {
    const result = await apiPost('borrow_items', {
        name: data.name, category: data.category, total_qty: parseInt(data.total_qty) || 1
    });
    if (result.error) return result;
    return { success: true, message: `借用物品「${data.name}」已添加` };
}

async function deleteBorrowItem(id) {
    const item = await apiSingle('borrow_items', `id=eq.${id}`);
    if (!item) return { error: '物品不存在' };

    const count = await apiCount('borrow_records', `item_id=eq.${id}&status=eq.借出中`);
    if (count > 0) return { error: `该物品有 ${count} 条借出未还记录，无法删除` };

    const result = await apiDelete('borrow_items', `id=eq.${id}`);
    if (result.error) return result;
    return { success: true, message: `物品「${item.name}」已删除` };
}

async function updateBorrowItem(id, field, value) {
    const updateData = {};
    updateData[field] = field === 'total_qty' ? parseInt(value) : value;
    const result = await apiPatch('borrow_items', `id=eq.${id}`, updateData);
    if (result.error) return result;
    return { success: true };
}

async function getAdminBorrowRecords(filters = {}) {
    let query = 'select=*&order=created_at.desc';
    if (filters.department) query += `&department=eq.${encodeURIComponent(filters.department)}`;
    if (filters.status) query += `&status=eq.${encodeURIComponent(filters.status)}`;
    return apiGet('borrow_records', query);
}

async function returnBorrow(id) {
    const record = await apiSingle('borrow_records', `id=eq.${id}`);
    if (!record) return { error: '记录不存在' };
    if (record.status === '已归还') return { error: '该物品已归还' };

    const result = await apiPatch('borrow_records', `id=eq.${id}`, {
        status: '已归还', return_date: today()
    });
    if (result.error) return result;
    return { success: true, message: `物品「${record.item_name}」已确认归还` };
}

async function getAdminBorrowStats() {
    const itemList = await apiGet('borrow_items_available', 'select=*');
    const allRecords = await apiGet('borrow_records', 'select=*');

    const total_items = itemList.length;
    const total_borrowed = allRecords.filter(r => r.status === '借出中').length;
    const total_returned = allRecords.filter(r => r.status === '已归还').length;

    // 按物品统计
    const itemStatsMap = {};
    itemList.forEach(i => {
        itemStatsMap[i.id] = {
            name: i.name, category: i.category, total_qty: i.total_qty,
            out_qty: 0, returned_qty: 0
        };
    });
    allRecords.forEach(r => {
        if (itemStatsMap[r.item_id]) {
            if (r.status === '借出中') itemStatsMap[r.item_id].out_qty += r.quantity;
            else itemStatsMap[r.item_id].returned_qty += r.quantity;
        }
    });
    const item_stats = Object.values(itemStatsMap).sort((a, b) => b.out_qty - a.out_qty);

    // 按部门统计
    const deptMap = {};
    allRecords.forEach(r => {
        if (!deptMap[r.department]) deptMap[r.department] = { department: r.department, borrow_count: 0, total_qty: 0 };
        deptMap[r.department].borrow_count++;
        deptMap[r.department].total_qty += r.quantity;
    });
    const dept_stats = Object.values(deptMap).sort((a, b) => b.total_qty - a.total_qty);

    return {
        summary: { total_items, total_borrowed, total_returned, outstanding: total_borrowed },
        item_stats,
        dept_stats
    };
}

// ============================================================
// 管理员端 - 入库管理 API
// ============================================================

// 获取入库记录（支持筛选）
async function getStockInRecords(filters = {}) {
    let query = 'select=*&order=created_at.desc';
    if (filters.item_code) query += `&item_code=eq.${encodeURIComponent(filters.item_code)}`;
    if (filters.date_from) query += `&in_date=gte.${encodeURIComponent(filters.date_from)}`;
    if (filters.date_to) query += `&in_date=lte.${encodeURIComponent(filters.date_to)}`;
    try {
        return await apiGet('stock_in_records', query);
    } catch (e) {
        console.warn('入库记录表未创建或不可访问:', e);
        return [];
    }
}

// 新增入库记录（同时增加对应物品的采购数量）
async function addStockIn(data) {
    // 验证物品是否存在
    const item = await apiSingle('inventory', `code=eq.${encodeURIComponent(data.item_code)}`);
    if (!item) return { error: '物品编号不存在' };

    const result = await apiPost('stock_in_records', {
        in_date: data.in_date || today(),
        item_code: data.item_code,
        item_name: item.name,
        quantity: parseInt(data.quantity),
        supplier: data.supplier || '',
        operator: data.operator || '',
        notes: data.notes || ''
    });

    if (result.error) return result;

    // 入库成功后，自动增加物品的采购数量（purchase_qty）
    const newPurchaseQty = (item.purchase_qty || 0) + parseInt(data.quantity);
    const updateResult = await apiPatch('inventory', `code=eq.${encodeURIComponent(data.item_code)}`, {
        purchase_qty: newPurchaseQty
    });

    if (updateResult.error) {
        return { success: true, message: '入库记录已添加，但库存数量更新失败，请手动调整', warning: true };
    }

    return { success: true, message: `物品「${item.name}」入库 ${data.quantity} ${item.unit}，库存已更新` };
}

// 删除入库记录（同时扣减对应物品的采购数量）
async function deleteStockIn(id) {
    const record = await apiSingle('stock_in_records', `id=eq.${id}`);
    if (!record) return { error: '入库记录不存在' };

    const result = await apiDelete('stock_in_records', `id=eq.${id}`);
    if (result.error) return result;

    // 删除记录后，扣减对应物品的采购数量
    const item = await apiSingle('inventory', `code=eq.${encodeURIComponent(record.item_code)}`);
    if (item) {
        const newPurchaseQty = Math.max(0, (item.purchase_qty || 0) - parseInt(record.quantity));
        await apiPatch('inventory', `code=eq.${encodeURIComponent(record.item_code)}`, {
            purchase_qty: newPurchaseQty
        });
    }

    return { success: true, message: `入库记录已删除，对应物品库存已扣减 ${record.quantity}` };
}

// 获取入库统计
async function getStockInStats() {
    try {
        const records = await apiGet('stock_in_records', 'select=item_code,item_name,quantity');
        const totalRecords = records.length;
        const totalQty = records.reduce((s, r) => s + r.quantity, 0);

        // 按物品统计入库量
        const itemMap = {};
        records.forEach(r => {
            if (!itemMap[r.item_code]) {
                itemMap[r.item_code] = { item_code: r.item_code, item_name: r.item_name, in_count: 0, total_qty: 0 };
            }
            itemMap[r.item_code].in_count++;
            itemMap[r.item_code].total_qty += r.quantity;
        });
        const item_stats = Object.values(itemMap).sort((a, b) => b.total_qty - a.total_qty);

        return {
            summary: { total_records: totalRecords, total_qty: totalQty },
            item_stats
        };
    } catch (e) {
        console.warn('入库统计获取失败:', e);
        return { summary: { total_records: 0, total_qty: 0 }, item_stats: [] };
    }
}

// ============================================================
// 需求采购管理 API
// ============================================================

// 提交需求采购申请（员工端）
async function submitPurchaseRequest(data) {
    const result = await apiPost('purchase_requests', {
        req_date: today(),
        department: data.department,
        requester: data.requester,
        item_name: data.item_name,
        category: data.category || '',
        quantity: parseInt(data.quantity),
        unit: data.unit || '',
        estimated_price: data.estimated_price ? parseFloat(data.estimated_price) : null,
        reason: data.reason || '',
        status: '待采购',
        notes: data.notes || ''
    });

    if (result.error) return result;
    return { success: true, message: '需求申请已提交，等待管理员采购' };
}

// 获取我的需求申请（员工端）
async function getMyPurchaseRequests(name) {
    try {
        return await apiGet('purchase_requests',
            `select=*&requester=eq.${encodeURIComponent(name)}&order=created_at.desc&limit=50`);
    } catch (e) {
        console.warn('需求采购表未创建或不可访问:', e);
        return [];
    }
}

// 获取所有需求采购申请（管理员端，支持筛选）
async function getAdminPurchaseRequests(filters = {}) {
    let query = 'select=*&order=created_at.desc';
    if (filters.department) query += `&department=eq.${encodeURIComponent(filters.department)}`;
    if (filters.status) query += `&status=eq.${encodeURIComponent(filters.status)}`;
    if (filters.date_from) query += `&req_date=gte.${encodeURIComponent(filters.date_from)}`;
    if (filters.date_to) query += `&req_date=lte.${encodeURIComponent(filters.date_to)}`;
    try {
        return await apiGet('purchase_requests', query);
    } catch (e) {
        console.warn('需求采购表未创建或不可访问:', e);
        return [];
    }
}

// 更新需求采购状态（管理员端）
async function updatePurchaseRequestStatus(id, status, notes = '') {
    const updateData = { status };
    if (notes) updateData.notes = notes;
    const result = await apiPatch('purchase_requests', `id=eq.${id}`, updateData);
    if (result.error) return result;
    return { success: true, message: `需求已标记为「${status}」` };
}

// 删除需求采购申请
async function deletePurchaseRequest(id) {
    const result = await apiDelete('purchase_requests', `id=eq.${id}`);
    if (result.error) return result;
    return { success: true, message: '需求申请已删除' };
}

// 获取需求采购统计
async function getPurchaseRequestStats() {
    try {
        const records = await apiGet('purchase_requests', 'select=status,quantity');
        const pending = records.filter(r => r.status === '待采购').length;
        const purchased = records.filter(r => r.status === '已采购').length;
        const rejected = records.filter(r => r.status === '已拒绝').length;
        const totalQty = records.reduce((s, r) => s + (r.quantity || 0), 0);
        return {
            summary: { total: records.length, pending, purchased, rejected, total_qty: totalQty }
        };
    } catch (e) {
        console.warn('需求采购统计获取失败:', e);
        return { summary: { total: 0, pending: 0, purchased: 0, rejected: 0, total_qty: 0 } };
    }
}
