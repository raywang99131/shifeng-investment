import React, { useState } from 'react';
import { Select, Button, Modal, Form, Input, InputNumber, Popconfirm, Space, message } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { type Fund } from '../../types/fund';

const INITIAL_MAP = {
  a: { value: 1000000, label: '元', suffix: '初始规模默认为 100万元' },
  hk: { value: 1000000, label: '港币', suffix: '初始规模默认为 100万港币' },
  us: { value: 100000, label: '美元', suffix: '初始规模默认为 10万美元' },
  jp: { value: 10000000, label: '日元', suffix: '初始规模默认为 1000万日元' },
  kr: { value: 10000000, label: '韩元', suffix: '初始规模默认为 1000万韩元' },
};

interface FundSwitcherProps {
  funds: Fund[];
  currentFundId: string | null;
  onSelect: (id: string) => void;
  onAdd: (name: string, initialCapital: number, market?: 'a' | 'hk' | 'us' | 'jp' | 'kr') => void;
  onUpdate: (id: string, updates: { name?: string; initialCapital?: number }) => void;
  onDelete: (id: string) => void;
}

const FundSwitcher: React.FC<FundSwitcherProps> = ({
  funds,
  currentFundId,
  onSelect,
  onAdd,
  onUpdate,
  onDelete,
}) => {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingFund, setEditingFund] = useState<Fund | null>(null);
  const [market, setMarket] = useState<'a' | 'hk' | 'us' | 'jp' | 'kr'>('a');
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  const handleAdd = () => {
    form.validateFields().then((values) => {
      onAdd(values.name, Number(values.initialCapital) || INITIAL_MAP[market].value, market);
      form.resetFields();
      setAddModalOpen(false);
      setMarket('a');
      message.success('基金已添加');
    });
  };

  const handleMarketChange = (v: 'a' | 'hk' | 'us' | 'jp' | 'kr') => {
    setMarket(v);
    form.setFieldsValue({ initialCapital: INITIAL_MAP[v].value });
  };

  const handleEdit = () => {
    editForm.validateFields().then((values) => {
      if (editingFund) {
        onUpdate(editingFund.id, {
          name: values.name,
          initialCapital: Number(values.initialCapital),
        });
        setEditModalOpen(false);
        setEditingFund(null);
        message.success('基金信息已更新');
      }
    });
  };

  const openEdit = (fund: Fund) => {
    setEditingFund(fund);
    editForm.setFieldsValue({ name: fund.name, initialCapital: fund.initialCapital });
    setEditModalOpen(true);
  };

  const currentFund = funds.find((f) => f.id === currentFundId);

  return (
    <>
      <Space>
        <Select
          value={currentFundId}
          onChange={onSelect}
          style={{ width: 180 }}
          options={funds.map((f) => ({ label: f.name, value: f.id }))}
        />
        <Button icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
          添加基金
        </Button>
        {funds.length > 1 && currentFundId && (
          <Popconfirm
            title={`确认删除「${currentFund?.name}」？`}
            description={`该基金有 ${currentFund?.positions.length || 0} 只持仓，删除后不可恢复。`}
            onConfirm={() => { onDelete(currentFundId); message.success('基金已删除'); }}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        )}
        {currentFundId && (
          <Button icon={<EditOutlined />} onClick={() => {
            const fund = funds.find((f) => f.id === currentFundId);
            if (fund) openEdit(fund);
          }}>
            编辑
          </Button>
        )}
      </Space>

      <Modal title="添加基金" open={addModalOpen} onOk={handleAdd} onCancel={() => setAddModalOpen(false)} okText="添加" cancelText="取消" destroyOnHidden>
        <div onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}>
          <Form form={form} layout="vertical">
            <Form.Item name="name" label="基金名称" rules={[{ required: true, message: '请输入基金名称' }]}>
              <Input placeholder="如 锋行成长1号" />
            </Form.Item>
            <Form.Item name="market" label="市场" rules={[{ required: true, message: '请选择市场' }]}>
              <Select onChange={handleMarketChange}>
                <Select.Option value="a">A股</Select.Option>
                <Select.Option value="hk">港股</Select.Option>
                <Select.Option value="us">美股</Select.Option>
                <Select.Option value="jp">日股</Select.Option>
                  <Select.Option value="kr">韩股</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item
              name="initialCapital"
              label={`初始规模（${INITIAL_MAP[market].label}）`}
              rules={[{ required: true, message: '请输入初始规模' }, { type: 'number', min: 0, message: '规模不能为负' }]}
              extra={INITIAL_MAP[market].suffix}
            >
              <InputNumber placeholder={`如 ${INITIAL_MAP[market].value.toLocaleString()}`} style={{ width: '100%' }} min={0} precision={0} />
            </Form.Item>
          </Form>
        </div>
      </Modal>

      <Modal title="编辑基金" open={editModalOpen} onOk={handleEdit} onCancel={() => setEditModalOpen(false)} okText="保存" cancelText="取消" destroyOnHidden>
        <div onKeyDown={(e) => { if (e.key === 'Enter') handleEdit(); }}>
          <Form form={editForm} layout="vertical">
            <Form.Item name="name" label="基金名称" rules={[{ required: true, message: '请输入基金名称' }]}>
              <Input placeholder="如 锋行成长1号" />
            </Form.Item>
            <Form.Item
              name="initialCapital"
              label="初始规模（元）"
              rules={[{ required: true, message: '请输入初始规模' }, { type: 'number', min: 0, message: '规模不能为负' }]}
            >
              <InputNumber placeholder="如 1000000（表示100万元）" style={{ width: '100%' }} min={0} precision={0} />
            </Form.Item>
          </Form>
        </div>
      </Modal>
    </>
  );
};

export default FundSwitcher;
