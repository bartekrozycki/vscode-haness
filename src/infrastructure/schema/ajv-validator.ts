import Ajv from 'ajv';
import type { SchemaValidator } from '../../application/ports';
export class AjvValidator implements SchemaValidator {
    private readonly ajv = new Ajv({ strict: false, allErrors: true });
    assertSchema(schema: Record<string, unknown>) { this.ajv.compile(schema); }
    validate(schema: Record<string, unknown>, input: Record<string, unknown>) {
        const validate = this.ajv.compile(schema);
        if (!validate(input))
            throw new Error(this.ajv.errorsText(validate.errors));
    }
}
