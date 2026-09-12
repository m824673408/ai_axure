import { CheckCircleFilled, ClockCircleOutlined, FileProtectOutlined } from '@ant-design/icons';
import { Alert, Button, Progress, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../components/shared';
import { previewContext } from '../previewContext';

const lintPassed = previewContext.lintStatus === 'PASS';
const lintBlocked = previewContext.lintStatus === 'BLOCKED';
const statusLabel = lintPassed ? 'PASS' : lintBlocked ? 'BLOCKED' : '待检查';
const checks = [
  { name: 'Schema & Product Lint', detail: previewContext.featureId ? `${previewContext.featureId} 的启动时检查快照` : '基础分支不做 Feature Scope 判定' },
  { name: 'Product Diff', detail: '请以终端 proto diff / proto check 输出为准' },
  { name: 'Prototype Build', detail: '请在进入 Review 前运行 proto check' },
];

export default function DashboardPage() {
  const navigate = useNavigate();
  return (
    <PageLayout title="产品总览" description="查看统一产品模型、当前需求和确定性治理状态。" actions={<Button type="primary" onClick={() => navigate('/attribution/rules')}>查看产品原型</Button>}>
      <Alert className="governance-alert" type={lintPassed ? 'success' : lintBlocked ? 'error' : 'warning'} showIcon message={lintPassed ? '启动 Preview 时 Product Lint 已通过' : lintBlocked ? '启动 Preview 时 Product Lint 已阻断' : '当前状态不能代替合并检查'} description="这是 Preview 启动时快照；进入 Review 前仍须运行 proto check，以终端结果为准。" />
      <div className="dashboard-layout">
        <section className="governance-panel" aria-labelledby="governance-title">
          <div className="section-heading"><div><Typography.Title id="governance-title" level={2}>治理检查</Typography.Title><Typography.Text type="secondary">Preview 启动时快照，不会随文件修改自动刷新。</Typography.Text></div><div className="score"><Progress type="circle" percent={lintPassed ? 100 : 0} size={62} status={lintBlocked ? 'exception' : 'normal'} strokeColor="#2f7a4f" /><span>{statusLabel}</span></div></div>
          <div className="check-list">
            {checks.map((check, index) => <div className="check-row" key={check.name}><CheckCircleFilled aria-hidden="true" /><div><strong>{check.name}</strong><span>{check.detail}</span></div><Tag color={index === 0 && lintPassed ? 'success' : index === 0 && lintBlocked ? 'error' : 'default'}>{index === 0 ? statusLabel : 'CLI'}</Tag></div>)}
          </div>
        </section>
        <aside className="feature-panel" aria-labelledby="feature-title">
          <div className="feature-icon" aria-hidden="true"><FileProtectOutlined /></div>
          <Typography.Title id="feature-title" level={2}>{previewContext.featureId ?? 'Baseline'}</Typography.Title>
          <Typography.Paragraph>{previewContext.featureName}</Typography.Paragraph>
          <dl className="feature-facts"><div><dt>当前分支</dt><dd>{previewContext.branch}</dd></div><div><dt>启动时检查</dt><dd>{statusLabel}</dd></div><div><dt>允许页面</dt><dd>{previewContext.allowedPages.join('、') || '未声明'}</dd></div><div><dt>最终依据</dt><dd>proto check</dd></div></dl>
        </aside>
      </div>
      <section className="workflow" aria-labelledby="workflow-title">
        <Typography.Title id="workflow-title" level={2}>Feature 工作流</Typography.Title>
        <div className="workflow-steps">
          {[['Context', '读取产品与范围', <CheckCircleFilled />], ['Coding', '在授权路径开发', <CheckCircleFilled />], ['Lint', '确定性检查通过', <CheckCircleFilled />], ['Review', '等待 Product Owner', <ClockCircleOutlined />]].map(([title, detail, icon], index) => <div className={`workflow-step ${index === 3 ? 'is-pending' : ''}`} key={String(title)}><span className="step-icon">{icon}</span><div><strong>{title}</strong><span>{detail}</span></div></div>)}
        </div>
      </section>
    </PageLayout>
  );
}
