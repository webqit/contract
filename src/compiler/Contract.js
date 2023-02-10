
/**
 * @imports
 */
import Common from './Common.js';
import Context from './Context.js';
import Scope from './Scope.js';
import Memo from './Memo.js';
import Condition from './Condition.js';
import SignalReference from './SignalReference.js';
import EffectReference from './EffectReference.js';
import Node from './Node.js';

export default class Contract extends Common {

    constructor( ownerContext, id, def ) {
        super( id, def );
        this.ownerContext = ownerContext;
        // These derivations must be done here at constructor level
        this.ownerContract = ownerContext && ( ownerContext.currentContract || ownerContext );
        this.ownerScope = ownerContext && ( ownerContext.currentScope || ownerContext.ownerScope );
        // Subscript identifers
        this.subscriptIdentifiers = {};
        // Reference
        this.references = [];
        this.referenceStack = [];
        // Entries
        this.entries = [];
        this.entryStack = [];
        // Memos
        this.memos = [];
        // Hoisting
        this._hoistedAwaitKeyword = undefined;
        this._hoistedExitStatements = new Map;
        // IDs
        this._nextIds = {};
        // Function-level flag
        this.sideEffects = [];
        // Contract-level flag
        this.$sideEffects = false;
    }

    get $params() {
        return this.params || (
            this.ownerContract && this.ownerContract.$params
        );
    }

    nextId( name ) {
        if ( this.ownerContext ) return this.ownerContext.nextId( name );
        name = '';
        if ( typeof this._nextIds[ name ] === 'undefined' ) { this._nextIds[ name ] = 0; }
        return this._nextIds[ name ] ++;
    }

    // ---------------

    closest( typeOrCallback = null, withLevel = false, prevLevel = -1 ) {
        if ( !arguments.length ) return this.ownerContract;
        let currentLevel = prevLevel + 1;
        if ( typeof typeOrCallback === 'function' ? typeOrCallback( this, currentLevel ) : [].concat( typeOrCallback ).some( type => type === this.type ) ) {
            return withLevel ? { instance: this, level: currentLevel } : this;
        }
        if ( this.ownerContract ) {
            return this.ownerContract.closest( typeOrCallback, withLevel, currentLevel );
        }
    }

    closestContext( withLevel = false ) {
        return this.closest( instance => ( instance instanceof Context ), withLevel );
    }

    closestFunction( withLevel = false ) {
        return this.closest( [ 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression' ], withLevel );
    }

    // -----------------

    defineSubscriptIdentifier( id, whitelist, blacklist = [] ) {
        const idObject = {};
        Object.defineProperty( idObject, 'whitelist', { value: whitelist, writable: true } );
        Object.defineProperty( idObject, 'blacklist', { value: blacklist, writable: true } );
        Object.defineProperty( idObject, 'toString', { value: function() {
            return this.whitelist[ 0 ];
        } } );
        this.subscriptIdentifiers[ id ] = idObject;
    }

    getSubscriptIdentifier( id, globally = false ) {
        return this.subscriptIdentifiers[ id ] || (
            globally && this.ownerContract && this.ownerContract.getSubscriptIdentifier( id, globally )
        );
    }

    subscriptIdentifiersNoConflict( identifier ) {
        if ( identifier.type !== 'Identifier' ) {
            throw new Error(`An implied Identifier is of type ${ identifier.type }`);
        }
        for ( let id in this.subscriptIdentifiers ) {
            let subscriptIdentifier = this.subscriptIdentifiers[ id ];
            let i = subscriptIdentifier.whitelist.indexOf( identifier.name );
            if ( i === -1 ) continue;
            subscriptIdentifier.blacklist.push( subscriptIdentifier.whitelist.splice( i, 1 ) );
            if ( !subscriptIdentifier.whitelist.length ) {
                subscriptIdentifier.whitelist = subscriptIdentifier.blacklist.map( name => {
                    let newVar;
                    do {
                        let randChar = String.fromCharCode( 0 | Math.random() *26 +97 );
                        newVar = `${ name }${ randChar }`;
                    } while ( subscriptIdentifier.blacklist.includes( newVar ) );
                    return newVar;
                });
            }
        }
        this.ownerContract && this.ownerContract.subscriptIdentifiersNoConflict( identifier );
    }

    // ---------------

    get currentReference() {
        return this.referenceStack[ 0 ];
    }

    // ---------------

    pushReference( reference, callback ) {
        this.references.unshift( reference );
        // IMPORTANT: save this before unshift();
        let currentReference = this.currentReference;

        // Keep in stack while callback runs
        this.referenceStack.unshift( reference );
        let result = callback( reference, currentReference );
        let _reference = this.referenceStack.shift();
        
        // Just to be sure
        if ( _reference !== reference ) {
            throw new Error( `Reference stack corrupted.` );
        }
        return result;
    }

    signalReference( def, callback, resolveInScope = true ) {
        let reference = new SignalReference( this, this.nextId( 'causes' ), def );
        let result = this.pushReference( reference, callback );

        // Observe references in scope
        let targetContext = this.closestContext();
        let targetScope = targetContext.currentScope || targetContext.ownerScope /* when an Iteration */;
        
        if ( !reference.refs.size || ( this.type === 'VariableDeclaration' && this.kind === 'const' ) || ( resolveInScope && !targetScope.doSubscribe( reference ) ) ) {
            this.references = this.references.filter( _reference => _reference !== reference );
        }

        // Return callback result
        return result;
    }

    effectReference( def, callback, resolveInScope = true ) {
        let reference = new EffectReference( this, this.nextId( 'affecteds' ), def );
        let result = this.pushReference( reference, callback );

        // IMPORTANT: for resolving other references in scope
        let targetContext = this.closestContext();
        let targetScope = targetContext.currentScope || targetContext.ownerScope /* when an Iteration */;
        targetScope.pushEffectReference( reference );

        // Update references in scope
        if ( !reference.refs.size ) {
            this.references = this.references.filter( _reference => _reference !== reference )
        } else if ( ( reference.type !== 'VariableDeclaration' || reference.kind === 'var' ) && resolveInScope ) {
            targetScope.doUpdate( reference );
        }

        // Return callback result
        return result;
    }

    chainableReference( def, callback ) {
        return this.currentReference && this.currentReference.propertyStack.length
            ? callback()
            : this.signalReference( def, callback );
    }

    embeddableSignalReference( def, callback ) {
        return this.currentReference && this.signalReference( def, ( reference, currentReference ) => {
            reference.embeddingReference = currentReference;
            return callback( reference, currentReference );
        } );
    }

    embeddableEffectReference( def, callback ) {
        return this.effectReference( def, ( reference, currentReference ) => {
            reference.embeddingReference = currentReference;
            return callback( reference, currentReference );
        } );
    }

    // ---------------

    get currentScope() {
        return this.entryStack.reduce( ( scope, current ) => scope || ( current instanceof Scope ) && current, null );
    }

    get currentCondition() {
        return this.entryStack.reduce( ( condition, current ) => condition || ( current instanceof Condition ) && current, null )
        || ( this.closestFunction() !== this && this.ownerContext && this.ownerContext.currentCondition );
    }

    get currentContext() {
        return this.entryStack.reduce( ( context, current ) => context || ( current instanceof Context ) && current, null );
    }

    get currentContract() {
        return this.entryStack.reduce( ( effect, current ) => effect || ( current instanceof Contract ) && current, null );
    }

    get currentEntry() {
        return this.entryStack[ 0 ];
    }

    // ---------------

    pushEntry( entry, callback ) {
        this.entries.unshift( entry );
        // Keep in stack while callback runs
        this.entryStack.unshift( entry );
        let result = callback( entry );
        this.entryStack.shift();
        if ( ( entry instanceof Contract ) && !entry.generatable() ) {
            this.entries = this.entries.filter( _entry => _entry !== entry );
        }
        // Return callback result
        return result;
    }

    createScope( def, callback ) {
        let instance = new Scope( this, this.nextId( 'scope' ), def );
        return this.pushEntry( instance, callback );
    }

    createCondition( def, callback ) {
        let instance = new Condition( this, this.nextId( 'condition' ), def );
        return this.pushEntry( instance, callback );
    }

    // ---------------

    defineContext( def, callback ) {
        let instance = new Context( this, this.nextId( 'context' ), def );
        return this.pushEntry( instance, callback );
    }

    defineContract( def, callback ) {
        let instance = new Contract( this, this.nextId( 'contract' ), def );
        return this.pushEntry( instance, callback );
    }

    defineMemo( def ) {
        let memo = new Memo( this, this.nextId( 'memo' ), def );
        this.memos.unshift( memo );
        return memo;
    }

    // ---------------

    getLabelInfo() {
        let type = this.type, label, target;
        if ( ( this.ownerScope || {} ).label ) {
            ( { label: { name: label }, type: target } = this.ownerScope );
        } else if ( type === 'Iteration' && this.ownerContract.ownerScope.label ) {
            ( { label: { name: label }, type: target } = this.ownerContract.ownerScope );
        };
        return { type, label, target, };
    }

    // ---------------

    get hoistedArgumentsKeyword() {
        return this._hoistedArgumentsKeyword;
    }
    
    get hoistedAwaitKeyword() {
        return this._hoistedAwaitKeyword;
    }

    get hoistedExitStatements() {
        return this._hoistedExitStatements;
    }

    hoistArgumentsKeyword() {
        if ( [ 'FunctionDeclaration', 'FunctionExpression' ].includes( this.type ) ) {
            this._hoistedArgumentsKeyword = true;
            return;
        }
        this.ownerContract && this.ownerContract.hoistArgumentsKeyword();
    }

    hoistAwaitKeyword() {
        if ( [ 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression' ].includes( this.type ) ) return;
        this._hoistedAwaitKeyword = true;
        this.ownerContract && this.ownerContract.hoistAwaitKeyword();
    }

    hoistExitStatement( keyword, arg ) {
        if ( [ 'break', 'continue' ].includes( keyword.value ) ) {
            let labelInfo = this.getLabelInfo();
            let isLast = labelInfo.type === 'Iteration'
                ? labelInfo.target !== 'BlockStatement' && ( arg.value === labelInfo.label || !arg.value )
                : arg.value && arg.value === labelInfo.label;
            if ( isLast ) {
                this._hoistedExitStatements.set( keyword, { ...labelInfo, arg } );
                return labelInfo;
            }
        }
        this._hoistedExitStatements.set( keyword, arg );
        if ( this.ownerContract ) {
            return this.ownerContract.hoistExitStatement( keyword, arg );
        }
    }

    // ---------------

    generatable() {
        return this.references.length || ( this instanceof Context );
    }

    generate( expr, params = {} ) {
        if ( !expr || !this.generatable()  ) return expr;
        this.generated = true;
        let subscript$contract = Node.identifier( this.ownerContract.getSubscriptIdentifier( '$contract', true ) );

        let callee, body;
        if ( params.isFunctionContract ) {
            callee = expr;
        } else if ( this.inSequence ) {
            callee = Node.arrowFuncExpr( null, [ subscript$contract ], expr, this.hoistedAwaitKeyword, true /* expression */ );
        } else {
            body = Array.isArray( expr ) ? Node.blockStmt( expr ) : Node.blockStmt( [ expr ] );
            callee = Node.arrowFuncExpr( null, [ subscript$contract ], body, this.hoistedAwaitKeyword );
        }

        // Create the effect node
        let contractArgs = [ Node.literal( this.id ), ...( params.args || [] ), callee ];
        let contract = Node.callExpr( subscript$contract, contractArgs );
        if ( this.hoistedAwaitKeyword ) {
            contract = Node.awaitExpr( contract );
        }
        if ( this.inSequence || params.generateForArgument ) {
            return contract;
        }

        let _this = this;
        contract = Node.exprStmt( contract );
        const valueObject = {};
        Object.defineProperty( valueObject, 'toString', { value: () => _this.lineage } );
        Object.defineProperty( valueObject, 'trim', { value: function() {
            return this.toString();
        } } );
        contract.comments = [ { type: 'Line', value: valueObject, } ];
        // The list of returned statements
        let statements = [ contract ];
        this.hookExpr = statements;

        // Complete exits handling
        if ( !( this.ownerScope || {} ).singleStatementScope ) {
            let hoistedExits, seen = [], prevIf, pushIf = ( test, consequent ) => {
                let ifStmt = Node.ifStmt( test, consequent );
                if ( prevIf ) {
                    prevIf.alternate = ifStmt;
                } else {
                    prevIf = ifStmt;
                    statements.push( ifStmt );
                }
            };
            this.hoistedExitStatements.forEach( ( arg, keyword ) => {
                if ( [ 'break', 'continue' ].includes( keyword.value ) && !seen.includes( keyword.value ) && arg.arg ) {
                    let label = arg.arg;
                    // This keyword meets its target
                    let exitCheck = Node.callExpr(
                        Node.memberExpr( subscript$contract, Node.identifier( 'exiting' ) ),
                        [ keyword, label ]
                    );
                    let exitAction = Node.exprStmt(
                        Node.identifier( arg.type === 'Iteration' || !label.value ? keyword.value : keyword.value + ' ' + label.value )
                    );
                    pushIf( exitCheck, exitAction );
                    seen.push( keyword.value );
                } else {
                    hoistedExits = true;
                }
            } );
            if ( hoistedExits ) {
                // But not inside
                let exitCheck = Node.callExpr(
                    Node.memberExpr( subscript$contract, Node.identifier( 'exiting' ) )
                );
                let exitAction = Node.exprStmt( Node.identifier( 'return' ) );
                pushIf( exitCheck, exitAction );
            }
        }

        return statements;
    }

    get lineage() {
        let lineage = this.ownerContract && this.ownerContract.lineage;
        return this.ownerContract && !this.generated ? lineage : `${ lineage ? lineage + '/' : '' }${ this.id }`;
    }

    // -----------------
    
    toJson( filter = false ) {

        let json = {
            id: this.id,
            lineage: this.lineage,
            type: this.type,
            signals: {},
            effects: {},
            sideEffects: this.sideEffects.length ? true : undefined,
            $sideEffects: this.$sideEffects === true ? true : undefined,
            subContracts: {},
            conditions: {},
            hoistedAwaitKeyword: this.hoistedAwaitKeyword,
            hoistedArgumentsKeyword: this.hoistedArgumentsKeyword,
            loc: this.loc,
        };

        if ( this.originalSource ) { json.originalSource = this.originalSource; }

        this.references.forEach( reference => {
            let target;
            if ( reference instanceof SignalReference ) {
                target = json.signals;
            } else if ( reference instanceof EffectReference ) {
                target = json.effects;
            }
            target[ reference.id ] = reference.toJson( filter );
        } );

        let offset = this.lineage.split( '/' ).length;
        let find = lineage => lineage.reduce( ( _json, id ) => _json.subContracts[ id ], json );
        this.entries.slice( 0 ).reverse().forEach( entry => {
            if ( ( entry instanceof Contract ) && entry.generated ) {
                let target = find( entry.lineage.split( '/' ).slice( offset, -1 ) );
                target.subContracts[ entry.id ] = entry.toJson( filter );
            } else if ( entry instanceof Condition ) {
                let target = find( entry.ownerContract.lineage.split( '/' ).slice( offset ) );
                target.conditions[ entry.id ] = entry.toJson( filter );
            }
        } );

        return json;
    }

}