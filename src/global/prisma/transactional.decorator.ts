import { runInTransaction } from './transaction.storage';

export function Transactional(): MethodDecorator {
  return (_target, _propertyKey, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = function (this: any, ...args: any[]) {
      return runInTransaction(() => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}
