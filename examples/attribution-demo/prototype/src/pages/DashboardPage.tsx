import { CheckCircleFilled, ClockCircleOutlined, FileProtectOutlined, WarningFilled } from '@ant-design/icons';
import { Alert, Button, Progress, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { PageLayout, StatusTag } from '../components/shared';

const checks = [
  { name: 'Route structure', detail: '5 个页面路由均唯一', pass: true },
  { name: 'Navigation references', detail: '所有导航节点均存在路由', pass: true },
  { name: 'Component registry', detail: '5 个公共组件已登记', pass: true },
  { name: 'Feature scope', detail: 'REQ-DEMO-001 未越界', pass: true },
];

export default function DashboardPage() {
  const navigate = useNavigate();
  return (
    <PageLayout title="产品总览" description="查看统一产品模型、当前需求和确定性治理状态。" actions={<Button type="primary" onClick={() => navigate('/attribution/rules')}>审查演示需求</Button>}>
      <Alert className="governance-alert" type="success" showIcon message="当前 Workspace 可以进入 Review" description="Product Model、导航引用、公共组件登记与 Feature Scope 均通过检查。" />
      <div className="dashboard-layout">
        <section className="governance-panel" aria-labelledby="governance-title">
          <div className="section-heading"><div><Typography.Title id="governance-title" level={2}>治理检查</Typography.Title><Typography.Text type="secondary">与 `proto lint` 使用相同的结果表达。</Typography.Text></div><div className="score"><Progress type="circle" percent={100} size={62} strokeColor="oklch(0.5 0.13 150)" /><span>全部通过</span></div></div>
          <div className="check-list">
            {checks.map((check) => <div className="check-row" key={check.name}><CheckCircleFilled aria-hidden="true" /><div><strong>{check.name}</strong><span>{check.detail}</span></div><Tag color="success">PASS</Tag></div>)}
          </div>
        </section>
        <aside className="feature-panel" aria-labelledby="feature-title">
          <div className="feature-icon" aria-hidden="true"><FileProtectOutlined /></div>
          <Typography.Title id="feature-title" level={2}>REQ-DEMO-001</Typography.Title>
          <Typography.Paragraph>归因规则版本管理</Typography.Paragraph>
          <dl className="feature-facts"><div><dt>当前状态</dt><dd><StatusTag status="active" /></dd></div><div><dt>允许页面</dt><dd>attribution_rule</dd></div><div><dt>Product Model</dt><dd>无修改</dd></div><div><dt>Shared Component</dt><dd>无修改</dd></div></dl>
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
