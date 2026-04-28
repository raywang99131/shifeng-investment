import React, { useEffect } from 'react';
import { Modal, Form, Input, InputNumber } from 'antd';
import { type Fund } from '../../types/fund';

interface AddFundModalProps {
  open: boolean;
  fund?: Fund; // 如果有 fund则是编辑模式
  onClose: () => void;
  onSave: (name: string, initialCapital: number) => void;
}

const AddFundModal: React.FC<AddFundModalProps> = ({ open, fund, onClose, onSave }) => {
  const [form] = Form.useForm();
  const isEdit = !!fund;

  useEffect(() => {
    if (open) {
      if (fund) {
        form.setFieldsValue({ name: fund.name, initialCapital: Math.round(fund.initialCapital) });
      } else {
        form.setFieldsValue({ initialCapital: 1000000 });
      }
    }
  }, [open, fund, form]);

  const handleOk = () => {
    form.validateFields().then((values) => {
      if (isEdit) {
        onSave(values.name, Number(values.initialCapital));
      } else {
        onSave(values.name, 1000000); // 新建基金默认100万
      }
      onClose();
    });
  };

  return (
    <Modal
      title={isEdit ? '编辑基金' : '添加基金'}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText={isEdit ? '保存' : '添加'}
      cancelText="取消"
      destroyOnHidden
    >
      <div onKeyDown={(e) => { if (e.key === 'Enter') handleOk(); }}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="基金名称" rules={[{ required: true, message: '请输入基金名称' }]}>
            <Input placeholder="如 锋行成长1号" />
          </Form.Item>
          {!isEdit && (
            <Form.Item label="初始规模（元）" extra="新建基金初始规模默认为 100万元">
              <InputNumber value={1000000} disabled style={{ width: '100%' }} />
            </Form.Item>
          )}
        </Form>
      </div>
    </Modal>
  );
};

export default AddFundModal;
