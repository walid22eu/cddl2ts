import Lexer from './lexer'
import { Token, Tokens } from './tokens';
import { PREDEFINED_IDENTIFIER } from './constants'
import { parseNumberValue } from './utils'
import {
    Group, Type, PropertyName, PropertyType, PropertyReferenceType,
    Variable, RangePropertyReference, Occurrence, Property, Assignment
} from './ast'

const NIL_TOKEN: Token = { Type: Tokens.ILLEGAL, Literal: '' }
const DEFAULT_OCCURRENCE: Occurrence = { n: 1, m: 1 } // exactly one time

export default class Parser {
    l: Lexer;

    curToken: Token = NIL_TOKEN;
    peekToken: Token = NIL_TOKEN;

    constructor (l: Lexer) {
        this.l = l
        
        this.nextToken()
        this.nextToken()
    }

    private nextToken () {
        this.curToken = this.peekToken
        this.peekToken = this.l.nextToken()
        return true
    }

    private parseAssignments (): Assignment {
        let assignment: Assignment

        if (this.curToken.Type !== Tokens.IDENT && this.peekToken.Type !== Tokens.ASSIGN) {
            throw new Error(`group identifier expected, received "${JSON.stringify(this.curToken)}"`)
        }

        const groupName = this.curToken.Literal
        this.nextToken() // eat group identifier
        this.nextToken() // eat `=`
        const closingTokens = this.openSegment()

        /**
         * if no group segment was opened we have a variable assignment
         * and can return immediatelly
         */
        if (closingTokens.length === 0) {
            const variable: Variable = {
                Type: 'variable',
                Name: groupName,
                PropertyType: this.parsePropertyType()
            }
            this.nextToken()
            return variable
        /**
         * if last closing token is "]" we have an array
         */
        } else if (closingTokens[closingTokens.length - 1] === Tokens.RBRACK) {
            assignment = {
                Type: 'array',
                Name: groupName,
                Values: []
            }
        /**
         * otherwise a group
         */
        } else {
            assignment = {
                Type: 'group',
                Name: groupName,
                Properties: []
            }
        }

        const valuesOrProperties = []
        while (!closingTokens.includes(this.curToken.Type)) {
            let propertyName = ''
            let propertyType: PropertyType[] = []
            let comment = ''

            const occurrence = this.parseOccurrences()

            propertyName = this.parsePropertyName()

            /**
             * if `,` is found we have a group reference and jump to the next line
             */
            if (this.curToken.Type === Tokens.COMMA || closingTokens.includes(this.curToken.Type)) {
                const tokenType = this.curToken.Type
                let parsedComments = false

                /**
                 * check if line has a comment
                 */
                if (this.peekToken.Type === Tokens.COMMENT) {
                    this.nextToken()
                    comment = this.parseComment()
                    parsedComments = true
                }

                valuesOrProperties.push({
                    Occurrence: occurrence,
                    Name: '',
                    Type: [{
                        Type: 'group' as PropertyReferenceType,
                        Value: propertyName
                    }],
                    Comment: comment
                })

                if (!parsedComments) {
                    this.nextToken()
                }

                /**
                 * only continue if next token contains a comma
                 */
                if (tokenType === Tokens.COMMA) {
                    continue
                }

                /**
                 * otherwise break
                 */
                break
            }

            /**
             * else if no colon was found, throw
             */
            else if (this.curToken.Type !== Tokens.COLON) {
                throw new Error('Expected ":"')
            }

            this.nextToken()

            /**
             * parse property value
             */
            propertyType.push(this.parsePropertyType())
            this.nextToken()
            // @ts-ignore
            while (this.curToken.Type === Tokens.SLASH) {
                this.nextToken() // eat `/`
                propertyType.push(this.parsePropertyType())
                this.nextToken()
            }

            /**
             * advance comma
             */
            // @ts-ignore
            if (this.curToken.Type === Tokens.COMMA) {
                this.nextToken()
            }

            comment = this.parseComment()

            valuesOrProperties.push({
                Occurrence: occurrence,
                Name: propertyName,
                Type: propertyType,
                Comment: comment
            })

            /**
             * if `}` is found we are at the end of the group
             */
            // @ts-ignore
            if (closingTokens.includes(this.curToken.Type)) {
                break
            }
        }

        /**
         * attach values or properties to assignment
         */
        if (assignment.Type === 'group') {
            assignment.Properties = valuesOrProperties
        } else {
            assignment.Values = valuesOrProperties
        }

        /**
         * close segment
         */
        while (this.curToken.Type === closingTokens.shift()) {
            this.nextToken()
        }

        return assignment
    }

    /**
     * checks if group segment is opened and forwards to beginning of
     * first property declaration
     * @returns {String[]}  closing tokens for group (either `}`, `)` or both)
     */
    private openSegment (): string[] {
        if (this.curToken.Type === Tokens.LBRACE) {
            this.nextToken()

            if (this.peekToken.Type === Tokens.LPAREN) {
                this.nextToken()
                return [Tokens.RPAREN, Tokens.RBRACE]
            }
            return [Tokens.RBRACE]
        } else if (this.curToken.Type === Tokens.LPAREN) {
            this.nextToken()
            return [Tokens.RPAREN]
        } else if (this.curToken.Type === Tokens.LBRACK) {
            this.nextToken()
            return [Tokens.RBRACK]
        }

        return []
    }

    private parsePropertyName (): PropertyName {
        /**
         * property name without quotes
         */
        if (this.curToken.Type === Tokens.IDENT || this.curToken.Type === Tokens.STRING) {
            const name = this.curToken.Literal

            if (PREDEFINED_IDENTIFIER.includes(name)) {
                throw new Error(`Name ${name} is a reserved word`)
            }

            this.nextToken()
            return name
        }

        throw new Error(`Expected property name, received ${this.curToken.Type}(${this.curToken.Literal}), ${this.peekToken.Type}(${this.peekToken.Literal})`)
    }

    private parsePropertyType (): PropertyType {
        let type: PropertyType
        
        switch (this.curToken.Literal) {
            case Type.BOOL:
            case Type.INT:
            case Type.UINT:
            case Type.NINT:
            case Type.FLOAT:
            case Type.FLOAT16:
            case Type.FLOAT32:
            case Type.FLOAT64:
            case Type.BSTR:
            case Type.BYTES:
            case Type.TSTR:
            case Type.TEXT:
                type = this.curToken.Literal
            default: {
                if (this.curToken.Type === Tokens.IDENT) {
                    type = this.curToken.Literal
                } else if (this.curToken.Type === Tokens.STRING) {
                    type = {
                        Type: 'literal' as PropertyReferenceType,
                        Value: this.curToken.Literal
                    }
                } else if (this.curToken.Type === Tokens.NUMBER || this.curToken.Type === Tokens.FLOAT) {
                    type = {
                        Type: 'literal' as PropertyReferenceType,
                        Value: parseNumberValue(this.curToken)
                    }
                } else {
                    throw new Error(`Invalid property type "${this.curToken.Literal}"`)
                }
            }
        }

        /**
         * check if type continue as a range
         */
        if (
            this.peekToken.Type === Tokens.DOT &&
            this.nextToken() &&
            this.peekToken.Type === Tokens.DOT
        ) {
            this.nextToken()
            let Inclusive = true

            /**
             * check if range excludes upper bound
             */
            if (this.peekToken.Type === Tokens.DOT) {
                Inclusive = false
                this.nextToken()
            }

            this.nextToken()
            const Min: RangePropertyReference = typeof type === 'string'
                ? type as string
                : type.Value as (number | string)
            type = {
                Type: 'range' as PropertyReferenceType,
                Value: {
                    Inclusive,
                    Min,
                    Max: this.parsePropertyType() as RangePropertyReference
                }
            }
        }

        return type
    }

    private parseOccurrences () {
        let occurrence = DEFAULT_OCCURRENCE

        /**
         * check for non-numbered occurrence indicator, e.g.
         * ```
         *  * bedroom: size,
         * ```
         * which is the same as:
         * ```
         *  ? bedroom: size,
         * ```
         * or have miniumum of 1 occurrence
         * ```
         *  + bedroom: size,
         * ```
         */
        if (this.curToken.Type === Tokens.QUEST || this.curToken.Type === Tokens.ASTERISK || this.curToken.Type === Tokens.PLUS) {
            const n = this.curToken.Type === Tokens.PLUS ? 1 : 0
            let m = Infinity

            /**
             * check if there is a max definition
             */
            if (this.peekToken.Type === Tokens.NUMBER) {
                m = parseInt(this.peekToken.Literal, 10)
                this.nextToken()
            }

            occurrence = { n, m }
            this.nextToken()
        /**
         * numbered occurrence indicator, e.g.
         * ```
         *  1*10 bedroom: size,
         * ```
         */
        } else if (
            this.curToken.Type === Tokens.NUMBER &&
            this.peekToken.Type === Tokens.ASTERISK
        ) {
            const n = parseInt(this.curToken.Literal, 10)
            let m = Infinity
            this.nextToken() // eat "n"
            this.nextToken() // eat "*"

            /**
             * check if there is a max definition
             */
            if (this.curToken.Type === Tokens.NUMBER) {
                m = parseInt(this.curToken.Literal, 10)
                this.nextToken()
            }

            occurrence = { n, m }
        }

        return occurrence
    }

    /**
     * check if line has a comment
     */
    private parseComment () {
        let comment = ''
        if (this.curToken.Type === Tokens.COMMENT) {
            comment = this.curToken.Literal.slice(2)
            this.nextToken()
        }

        return comment
    }

    parse () {
        const definition: Assignment[] = []

        while (this.curToken.Type !== Tokens.EOF) {
            const group = this.parseAssignments()
            if (group) {
                definition.push(group)
            }
        }

        return definition
    }
}