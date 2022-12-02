export default class CensorList {
  static censorList: CensorKeyValue[] = []
  static getAll(): CensorKeyValue[] {
    return this.censorList
  }
  static set(censorList: CensorKeyValue[]) {
    this.censorList = censorList
  }
}

export interface CensorKeyValue {
  key: string
  value: RegExp
}
