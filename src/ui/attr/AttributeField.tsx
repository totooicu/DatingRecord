// 按属性类型分发到对应控件
import type { Person } from '../../core/types';
import { listPersons } from '../../core/repo/persons';
import { existingInputChoices } from '../../core/repo/inputChoices';
import { ExistingTextInput } from '../ExistingTextInput';
import {
  BoolField,
  ColorField,
  DateField,
  DateTimeField,
  EnumField,
  EnumMultiField,
  NumberField,
  RatingField,
  RelationField,
  TagField,
  TextField,
  asStr,
  type FieldProps,
} from './basic';
import { GeoField, JsonField, SocialField } from './composite';

export function AttributeField({
  def,
  value,
  onChange,
  persons,
}: FieldProps & { persons?: Pick<Person, 'id' | 'displayName'>[] }) {
  const people =
    persons ?? listPersons({ includeArchived: true }).map((p) => ({ id: p.id, displayName: p.displayName }));
  const str = asStr(value);
  const props: FieldProps = { def, value, onChange };

  switch (def.type) {
    case 'longtext':
      return <ExistingTextInput source="attribute" attributeKey={def.key} disabledChoices={!!def.sensitive} multiline value={str} onChange={onChange} />;
    case 'number':
    case 'money':
      return <NumberField {...props} />;
    case 'date':
      return <DateField value={str} onChange={onChange} />;
    case 'datetime':
      return <DateTimeField value={str} onChange={onChange} />;
    case 'enum':
      return <EnumField {...props} />;
    case 'enumMulti':
      return <EnumMultiField {...props} />;
    case 'boolean':
      return <BoolField value={value} onChange={onChange} />;
    case 'rating':
      return <RatingField {...props} />;
    case 'tag':
      return <TagField value={value} onChange={onChange} choices={() => def.sensitive ? [] : existingInputChoices('attribute', def.key)} />;
    case 'phone':
      return <TextField value={str} onChange={onChange} type="tel" />;
    case 'email':
      return <TextField value={str} onChange={onChange} type="email" />;
    case 'url':
      return <TextField value={str} onChange={onChange} type="url" />;
    case 'color':
      return <ColorField value={str} onChange={onChange} />;
    case 'relation':
      return <RelationField value={str} onChange={onChange} people={people} />;
    case 'geo':
      return <GeoField value={value} onChange={onChange} />;
    case 'social':
      return <SocialField value={value} onChange={onChange} />;
    case 'json':
      return <JsonField value={value} onChange={onChange} />;
    default:
      return <ExistingTextInput source="attribute" attributeKey={def.key} disabledChoices={!!def.sensitive} value={str} onChange={(v) => onChange(v || null)} />;
  }
}
