/**
 * Supabase 配置文件
 *
 * 使用前请填写以下两个值（从 Supabase Dashboard 获取）：
 * 1. 打开 https://supabase.com 注册并创建项目
 * 2. 进入 项目设置 > API
 * 3. 复制 "Project URL" 和 "anon public" 密钥
 */

const SUPABASE_URL = 'https://tgrabgwmnfkxugiyvfpk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_u3rPGcaMabgCygN5wdDbOg_Aif22NBA';

// 部门列表
const DEPARTMENTS = [
    '党委(党建)办', '经济办', '民生办', '宣传办',
    '财务办', '绿美办', '纪检办', '基建办',
    '平安办(执法)', '平安办(治保会)', '平安办(消防办)'
];

// 管理员账号（前端验证，内部工具使用）
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';
